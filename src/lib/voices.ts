// Voices available through kie.ai. IDs are "<provider>:<voice>".
// Google (Gemini TTS) voices take a speaking-style instruction; ElevenLabs
// voices can be previewed at https://static.aiquickdraw.com/elevenlabs/voice/<id>.mp3
export const AUTO_VOICE = "auto";

export const VOICES = [
  { id: AUTO_VOICE, name: "Auto", gender: "any", note: "Google voice matching the creator" },
  { id: "gemini:Zephyr", name: "Zephyr", gender: "female", note: "bright (Google)" },
  { id: "gemini:Laomedeia", name: "Laomedeia", gender: "female", note: "upbeat (Google)" },
  { id: "gemini:Aoede", name: "Aoede", gender: "female", note: "breezy (Google)" },
  { id: "gemini:Puck", name: "Puck", gender: "male", note: "upbeat (Google)" },
  { id: "gemini:Fenrir", name: "Fenrir", gender: "male", note: "excitable (Google)" },
  { id: "gemini:Achird", name: "Achird", gender: "male", note: "friendly (Google)" },
  { id: "elevenlabs:TX3LPaxmHKxFdv7VOQHJ", name: "Liam", gender: "male", note: "social media creator (ElevenLabs)" },
  { id: "elevenlabs:kPzsL2i3teMYv0FxEYQ6", name: "Brittney", gender: "female", note: "fun, youthful (ElevenLabs)" },
  { id: "elevenlabs:BZgkqPqms7Kj9ulSkVzn", name: "Eve", gender: "female", note: "authentic, energetic (ElevenLabs)" },
  { id: "elevenlabs:1SM7GgM6IMuvQlz2BwM3", name: "Mark", gender: "male", note: "casual, relaxed (ElevenLabs)" },
] as const;

export type VoiceProvider = "gemini" | "elevenlabs";

// Older jobs stored bare ElevenLabs IDs, so an ID without a prefix is ElevenLabs.
export function parseVoice(id: string): { provider: VoiceProvider; voice: string } {
  const [prefix, rest] = id.includes(":") ? id.split(/:(.*)/s) : ["elevenlabs", id];
  return { provider: prefix === "gemini" ? "gemini" : "elevenlabs", voice: rest };
}

// A Google voice matching the creator's described gender. Used for "auto" and
// when ElevenLabs fails.
export function fallbackGeminiVoice(actorDescription: string): string {
  return /\b(woman|female|girl|lady)\b/i.test(actorDescription) ? "gemini:Zephyr" : "gemini:Puck";
}

export function resolveVoice(voiceId: string, actorDescription: string): string {
  return voiceId === AUTO_VOICE ? fallbackGeminiVoice(actorDescription) : voiceId;
}
