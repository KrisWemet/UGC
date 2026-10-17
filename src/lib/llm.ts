import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { config, requireEnv } from "./config";
import { kieClaudeJson } from "./kie-claude";
import { openRouterJson } from "./openrouter";
import type { ScrapedSite } from "./scrape";
import {
  ProductBriefSchema,
  ScriptSchema,
  type ProductBrief,
  type Research,
  type Script,
  type Source,
  type VideoMode,
} from "./types";

// Created lazily so the app can run on OpenRouter alone.
let anthropic: Anthropic | null = null;
const client = () => (anthropic ??= new Anthropic({ apiKey: requireEnv("ANTHROPIC_API_KEY") }));

// Which LLM writes the brief and scripts:
// - "anthropic": Claude on Anthropic's API, with web search and structured outputs
// - "kie": Claude through kie.ai on kie.ai credits (site content only)
// - "openrouter": free OpenRouter models (site content only)
// LLM_PROVIDER picks one; otherwise the first with a key, in that order.
type Provider = "anthropic" | "kie" | "openrouter";

export function llmProviders(): Provider[] {
  const available: Provider[] = [];
  if (process.env.ANTHROPIC_API_KEY) available.push("anthropic");
  if (process.env.KIE_API_KEY) available.push("kie");
  if (process.env.OPENROUTER_API_KEY) available.push("openrouter");
  const preferred = process.env.LLM_PROVIDER as Provider | undefined;
  if (preferred && available.includes(preferred)) {
    return [preferred, ...available.filter((p) => p !== preferred)];
  }
  if (available.length === 0) throw new Error("Set ANTHROPIC_API_KEY, KIE_API_KEY or OPENROUTER_API_KEY. See .env.example.");
  return available;
}

// One structured-output call. If the first provider fails (outage, bad
// output), the next one with a key gets a turn.
async function structured<T extends z.ZodType>(opts: {
  schema: T;
  system: string;
  user: string;
  effort: "medium" | "high";
  step: string;
}): Promise<z.infer<T>> {
  const providers = llmProviders();
  let lastError: unknown;
  for (const provider of providers) {
    try {
      if (provider === "kie") return await kieClaudeJson(opts.schema, opts.system, opts.user);
      if (provider === "openrouter") return await openRouterJson(opts.schema, opts.system, opts.user);
      return await anthropicStructured(opts);
    } catch (err) {
      lastError = err;
      console.error(`${provider} failed on the ${opts.step} step:`, err);
    }
  }
  throw lastError;
}

async function anthropicStructured<T extends z.ZodType>(opts: {
  schema: T;
  system: string;
  user: string;
  effort: "medium" | "high";
  step: string;
}): Promise<z.infer<T>> {
  const response = await client().beta.messages.parse({
    model: config.claudeModel,
    max_tokens: 16000,
    output_config: { effort: opts.effort, format: betaZodOutputFormat(opts.schema) },
    system: opts.system,
    messages: [{ role: "user", content: opts.user }],
    ...FALLBACK,
  });
  assertNotRefused(response, opts.step);
  if (!response.parsed_output) throw new Error(`Claude's ${opts.step} did not match the schema.`);
  return response.parsed_output as z.infer<T>;
}

// Server-side fallback: if a request is declined by a safety classifier, the
// API retries it on Anthropic's recommended fallback model in the same call.
const FALLBACK = {
  betas: ["server-side-fallback-2026-07-01"],
  fallbacks: "default" as const,
};

function assertNotRefused(message: Anthropic.Beta.BetaMessage, step: string) {
  if (message.stop_reason === "refusal") {
    throw new Error(`Claude declined the ${step} step. Try a different URL or angle.`);
  }
}

// ── Step 1: web research ───────────────────────────────────────────────────

async function webResearch(site: ScrapedSite): Promise<{ notes: string; sources: Source[] }> {
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    {
      role: "user",
      content: `Research this product for a short-form video ad: ${site.url} (page title: "${site.title}").

Search the web for what real customers say about it (reviews, Reddit, forums, comparisons), the problems it solves, its pricing, and its main competitors. Then write concise research notes. Separate what you verified from what you are inferring, and say so when you found little.`,
    },
  ];
  const sources = new Map<string, Source>();
  let notes = "";

  // Server-side tools can pause a long turn; resume until the turn ends.
  for (let i = 0; i < 4; i++) {
    const response = await client().beta.messages.create({
      model: config.claudeModel,
      max_tokens: 16000,
      output_config: { effort: "medium" },
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 6 }],
      messages,
      ...FALLBACK,
    });
    assertNotRefused(response, "research");
    for (const block of response.content) {
      if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
        for (const r of block.content) sources.set(r.url, { title: r.title, url: r.url });
      }
      if (block.type === "text") notes += block.text;
    }
    if (response.stop_reason !== "pause_turn") break;
    messages.push({ role: "assistant", content: response.content });
  }
  return { notes, sources: [...sources.values()].slice(0, 12) };
}

// ── Step 2: synthesize a product brief ─────────────────────────────────────

async function synthesizeBrief(site: ScrapedSite, notes: string): Promise<ProductBrief> {
  const sitePages = [
    `URL: ${site.url}`,
    `Title: ${site.title}`,
    `Meta description: ${site.description}`,
    `Headings: ${site.headings.join(" | ")}`,
    `Homepage text:\n${site.text}`,
    ...site.extraPages.map((p) => `Page ${p.url}:\n${p.text}`),
  ].join("\n\n");

  return structured({
    schema: ProductBriefSchema,
    effort: "medium",
    step: "brief",
    system:
      "You are a performance-marketing strategist who writes briefs for UGC-style short video ads. Ground every claim in the website content or the research notes. Put a claim in verifiableClaims only if a viewer could confirm it on the site or in a cited source; never invent statistics, customer counts or results.",
    user: `<website>\n${sitePages}\n</website>\n\n<research_notes>\n${notes || "No web research available."}\n</research_notes>\n\nWrite the product brief. Include 4-8 pain points, 4-6 hook ideas and 3-5 distinct angles.`,
  });
}

export async function researchProduct(site: ScrapedSite): Promise<Research> {
  // Web search needs Anthropic's server-side tool; the other providers get the
  // site content only.
  const research =
    llmProviders()[0] === "anthropic" ? webResearch(site) : Promise.resolve({ notes: "", sources: [] as Source[] });
  const { notes, sources } = await research.catch((err) => {
    // Web research is a bonus; the site content alone can still produce a brief.
    console.error("web research failed, continuing with site content only:", err);
    return { notes: "", sources: [] as Source[] };
  });
  const brief = await synthesizeBrief(site, notes);
  return { url: site.url, brief, images: site.images, sources };
}

// ── Step 3: scripts ────────────────────────────────────────────────────────

const STRUCTURES: Record<VideoMode, string> = {
  actor: `Use exactly 5 segments in this order:
1. hook (shot "actor"): the creator says a scroll-stopping first line.
2. problem (shot "visual"): voiceover over an image of the problem.
3. solution (shot "actor"): the creator introduces the product naturally.
4. demo (shot "visual"): voiceover over the product or the result.
5. cta (shot "actor"): a short call to action ("link in bio" style).`,
  faceless: `Use 5 to 6 segments, all with shot "visual": hook, problem, solution, demo (and optionally proof), cta.
The voiceover carries the story; every segment needs a strong image.`,
};

export async function generateScripts(
  research: Research,
  mode: VideoMode,
  count: number,
): Promise<Script[]> {
  const imageList = research.images.length
    ? research.images.map((img, i) => `${i}: ${img.alt || "(no alt text)"} — ${img.url}`).join("\n")
    : "None found.";

  const { scripts } = await structured({
    schema: z.object({ scripts: z.array(ScriptSchema) }),
    effort: "high",
    step: "script",
    system: `You write short-form UGC-style video ads for TikTok, Reels and Shorts.

Voice: a real person casually sharing a find with a friend. Contractions, short sentences, no corporate language.

Honesty rules (these ads must comply with FTC and Competition Bureau guidance):
- The speaker is a creator presenting the product, not a customer giving a testimonial. Never claim personal results, long-term use, or "I've been using this for months".
- Only state facts from the brief's verifiableClaims, keyFeatures or pricing. No invented numbers.
- No fake urgency (no invented discounts or deadlines).
- Never claim or imply a partnership, sponsorship or official relationship with the brand (no "#partner", "#ambassador", "official" wording) unless the brief says one exists.`,
    user: `<brief>\n${JSON.stringify(research.brief, null, 2)}\n</brief>

<site_images>\n${imageList}\n</site_images>

Write ${count} different scripts, each built on a different angle or pain point.

${STRUCTURES[mode]}

Length: 55-75 spoken words in total per script (about 20-28 seconds). Each segment's narration is what is spoken during that segment.

For every "visual" segment, write imagePrompt: a specific, photorealistic vertical (9:16) scene description with no text, logos or UI in the image. If one of the site images fits a solution/demo segment better (a real product shot or screenshot), also set siteImageIndex to its number; otherwise null. For "actor" segments set imagePrompt and siteImageIndex to null.

hookText: 2-5 words shown on screen during the hook.
actorDescription: physical appearance only (age, gender, ethnicity, hair, casual clothing), written in English, varied across scripts. Even in faceless mode, fill it in.
caption: a post caption that ends with a disclosure such as "#ad".`,
  });
  if (!scripts?.length) throw new Error("Claude returned no scripts.");
  return scripts.map((s) => normalizeScript(s, mode, research.images.length));
}

// Makes a script safe to render even if the model bent the structure rules.
export function normalizeScript(script: Script, mode: VideoMode, imageCount: number): Script {
  const segments = script.segments
    .filter((s) => s.narration.trim())
    .map((s) => {
      const shot = mode === "faceless" ? "visual" : s.shot;
      const siteImageIndex =
        s.siteImageIndex !== null && s.siteImageIndex >= 0 && s.siteImageIndex < imageCount
          ? s.siteImageIndex
          : null;
      const imagePrompt =
        shot === "visual"
          ? s.imagePrompt?.trim() || `Photorealistic vertical lifestyle scene illustrating: ${s.narration}`
          : null;
      return { ...s, shot, imagePrompt, siteImageIndex: shot === "visual" ? siteImageIndex : null };
    });
  if (segments.length === 0) throw new Error(`Script "${script.title}" has no narration.`);
  // Belt and braces for the partnership rule above.
  const affiliation = /#\w*(partner|sponsor|ambassador|official)\w*/gi;
  const hashtags = script.hashtags.filter((h) => !h.match(affiliation));
  const caption = script.caption.replace(affiliation, "").replace(/\s{2,}/g, " ").trim();
  return { ...script, segments, hashtags, caption };
}
