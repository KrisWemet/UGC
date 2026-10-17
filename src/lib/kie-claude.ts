import Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";
import { config, requireEnv } from "./config";
import { jsonReply, type SendChat } from "./json-reply";

// Claude served by kie.ai on kie.ai credits, through its Anthropic-compatible
// endpoint. Differences from Anthropic's own API, found by testing:
// - the key goes in "Authorization: Bearer", not x-api-key
// - replies are JSON but not labelled application/json, so the SDK would
//   return them as a string; jsonFetch fixes the header
// - structured outputs and the web search tool are not supported, so the
//   app asks for JSON in the prompt and research uses site content only

const jsonFetch: typeof fetch = async (input, init) => {
  const res = await fetch(input, init);
  const type = res.headers.get("content-type") ?? "";
  if (type.includes("json") || type.includes("event-stream")) return res;
  const headers = new Headers(res.headers);
  headers.set("content-type", "application/json");
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
};

let client: Anthropic | null = null;
function kieClient() {
  return (client ??= new Anthropic({
    apiKey: null,
    authToken: requireEnv("KIE_API_KEY"),
    baseURL: `${config.kie.apiBase}/anthropic`,
    fetch: jsonFetch,
  }));
}

const send: SendChat = async (system, messages) => {
  const response = await kieClient().messages.create({
    model: config.kieClaudeModel,
    max_tokens: 16000,
    output_config: { effort: "medium" },
    system,
    messages,
  });
  if (response.stop_reason === "refusal") throw new Error("Claude declined this request.");
  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  if (!text.trim()) throw new Error("Claude (via kie.ai) returned an empty reply.");
  return text;
};

export function kieClaudeJson<T extends z.ZodType>(schema: T, system: string, user: string): Promise<z.infer<T>> {
  return jsonReply(send, schema, system, user);
}
