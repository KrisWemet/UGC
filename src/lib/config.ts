// Central place for model IDs. Each kie.ai model can be overridden by env var,
// since hosted model names change faster than this code.

export const config = {
  claudeModel: process.env.CLAUDE_MODEL ?? "claude-opus-5-5",
  kie: {
    apiBase: "https://api.kie.ai",
    uploadBase: "https://kieai.redpandaai.co",
    tts: process.env.KIE_TTS_MODEL ?? "elevenlabs/text-to-speech-multilingual-v2",
    image: process.env.KIE_IMAGE_MODEL ?? "seedream/5-flash-text-to-image",
    // "premium" talking head (Kling Avatar) and "budget" (Infinitalk).
    avatarPremium: process.env.KIE_AVATAR_MODEL ?? "kling/ai-avatar-standard",
    avatarBudget: process.env.KIE_AVATAR_BUDGET_MODEL ?? "infinitalk/from-audio",
  },
  video: { width: 1080, height: 1920, fps: 30 },
};

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}. See .env.example.`);
  return value;
}
