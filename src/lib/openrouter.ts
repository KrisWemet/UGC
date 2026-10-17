import { z } from "zod";
import { requireEnv } from "./config";

// Fallback LLM provider: free models on OpenRouter, used when no
// ANTHROPIC_API_KEY is set. OpenRouter tries the models in order.
const FREE_MODELS = (
  process.env.OPENROUTER_MODELS ??
  "nvidia/nemotron-3-super-120b-a12b:free,nvidia/nemotron-3.5-super-vl:free,openrouter/free"
)
  .split(",")
  .map((m) => m.trim())
  .filter(Boolean);

export function usingOpenRouter(): boolean {
  return !process.env.ANTHROPIC_API_KEY && !!process.env.OPENROUTER_API_KEY;
}

// Pulls the first JSON object out of a reply, tolerating code fences or prose.
export function extractJson(text: string): unknown {
  const cleaned = text.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("The model did not return JSON.");
  return JSON.parse(cleaned.slice(start, end + 1));
}

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

async function chat(messages: ChatMessage[], schema: object): Promise<string> {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${requireEnv("OPENROUTER_API_KEY")}`,
      "content-type": "application/json",
      "x-title": "UGC Studio",
    },
    body: JSON.stringify({
      models: FREE_MODELS,
      messages,
      max_tokens: 12000,
      temperature: 0.7,
      response_format: { type: "json_schema", json_schema: { name: "output", strict: false, schema } },
    }),
    signal: AbortSignal.timeout(240_000),
  });
  // OpenRouter may send whitespace keep-alives before the JSON body.
  const raw = await res.text();
  let body: any = null;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new Error(`OpenRouter returned unreadable output (${res.status}): ${raw.trim().slice(0, 200) || "empty body"}`);
  }
  if (!res.ok || body.error) {
    throw new Error(`OpenRouter error (${body.error?.code ?? res.status}): ${body.error?.message ?? "unknown error"}`);
  }
  const content = body.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error(`OpenRouter returned an empty reply${body.error?.message ? `: ${body.error.message}` : "."}`);
  }
  return content;
}

// Asks for JSON matching the schema and validates it. Free models slip up more
// often than Claude, so one failed attempt is sent back with the error.
export async function openRouterJson<T extends z.ZodType>(schema: T, system: string, user: string): Promise<z.infer<T>> {
  const jsonSchema = z.toJSONSchema(schema);
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: `${system}\n\nReply with only a JSON object that matches this JSON Schema. No prose, no code fences.\n${JSON.stringify(jsonSchema)}`,
    },
    { role: "user", content: user },
  ];
  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const reply = await chat(messages, jsonSchema);
    try {
      return schema.parse(extractJson(reply));
    } catch (err) {
      lastError = err instanceof Error ? err.message.slice(0, 1500) : String(err);
      messages.push(
        { role: "assistant", content: reply },
        { role: "user", content: `That reply was invalid: ${lastError}\nReply again with the corrected JSON only.` },
      );
    }
  }
  throw new Error(`The free model's reply didn't match the expected format: ${lastError.slice(0, 300)}`);
}
