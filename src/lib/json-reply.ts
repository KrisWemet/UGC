import { z } from "zod";

// For providers without enforced structured outputs: ask for JSON matching a
// schema, validate it with zod, and send one failed attempt back with the error.

export type ChatMessage = { role: "user" | "assistant"; content: string };
export type SendChat = (system: string, messages: ChatMessage[], jsonSchema: object) => Promise<string>;

// Pulls the first JSON object out of a reply, tolerating code fences or prose.
export function extractJson(text: string): unknown {
  const cleaned = text.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("The model did not return JSON.");
  return JSON.parse(cleaned.slice(start, end + 1));
}

export async function jsonReply<T extends z.ZodType>(
  send: SendChat,
  schema: T,
  system: string,
  user: string,
): Promise<z.infer<T>> {
  const jsonSchema = z.toJSONSchema(schema);
  const fullSystem = `${system}\n\nReply with only a JSON object that matches this JSON Schema. No prose, no code fences.\n${JSON.stringify(jsonSchema)}`;
  const messages: ChatMessage[] = [{ role: "user", content: user }];
  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const reply = await send(fullSystem, messages, jsonSchema);
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
  throw new Error(`The model's reply didn't match the expected format: ${lastError.slice(0, 300)}`);
}
