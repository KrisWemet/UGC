import type { z } from "zod";
import { requireEnv } from "./config";
import { jsonReply, type SendChat } from "./json-reply";

// Backup LLM provider: free models on OpenRouter. OpenRouter tries the models
// in order.
const FREE_MODELS = (
  process.env.OPENROUTER_MODELS ??
  "nvidia/nemotron-3-super-120b-a12b:free,nvidia/nemotron-3.5-super-vl:free,openrouter/free"
)
  .split(",")
  .map((m) => m.trim())
  .filter(Boolean);

const send: SendChat = async (system, messages, schema) => {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${requireEnv("OPENROUTER_API_KEY")}`,
      "content-type": "application/json",
      "x-title": "UGC Studio",
    },
    body: JSON.stringify({
      models: FREE_MODELS,
      messages: [{ role: "system", content: system }, ...messages],
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
  if (typeof content !== "string" || !content.trim()) throw new Error("OpenRouter returned an empty reply.");
  return content;
};

export function openRouterJson<T extends z.ZodType>(schema: T, system: string, user: string): Promise<z.infer<T>> {
  return jsonReply(send, schema, system, user);
}
