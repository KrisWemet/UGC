// Central place for model IDs and limits. Every fal/ElevenLabs model can be
// overridden by env var, since hosted model names change faster than this code.

export const config = {
  claudeModel: process.env.CLAUDE_MODEL ?? "claude-opus-5-5",
  fal: {
    image: process.env.FAL_IMAGE_MODEL ?? "fal-ai/flux-2-pro",
    avatar: process.env.FAL_AVATAR_MODEL ?? "fal-ai/kling-video/ai-avatar/v2/standard",
    img2video:
      process.env.FAL_IMG2VIDEO_MODEL ?? "fal-ai/minimax/hailuo-2.3-fast/standard/image-to-video",
    lipsync: process.env.FAL_LIPSYNC_MODEL ?? "veed/lipsync",
  },
  elevenlabsModel: process.env.ELEVENLABS_MODEL ?? "eleven_multilingual_v2",
  video: { width: 1080, height: 1920, fps: 30 },
};

// ElevenLabs premade voices (available on every account).
export const VOICES = [
  { id: "21m00Tcm4TlvDq8ikWAM", name: "Rachel", gender: "female", note: "calm" },
  { id: "EXAVITQu4vr4xnSDxMaL", name: "Bella", gender: "female", note: "soft" },
  { id: "29vD33N1CtxCmqQRPOHJ", name: "Drew", gender: "male", note: "confident" },
  { id: "ErXwobaYiN019PkySvjV", name: "Antoni", gender: "male", note: "warm" },
  { id: "TxGEqnHWrfWFTfGW9XjX", name: "Josh", gender: "male", note: "deep" },
] as const;

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}. See .env.example.`);
  return value;
}
