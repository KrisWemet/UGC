import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { WordTiming } from "./timing";

// Optional: real word timings from local Whisper via the HyperFrames CLI
// (`hyperframes transcribe`). Voices without timestamps (Google/Gemini) give
// estimated timings that drift by a second or more; this fixes captions and
// cut points. Enabled with ALIGN_CAPTIONS=whisper. Needs the CLI to be runnable
// (npx) and a few hundred MB for the model, so it's off by default and suits a
// local or container deployment more than serverless.

export function whisperAlignEnabled(): boolean {
  return process.env.ALIGN_CAPTIONS === "whisper";
}

export async function whisperWords(audioFile: string): Promise<WordTiming[]> {
  const dir = await mkdtemp(path.join(tmpdir(), "ugc-align-"));
  try {
    await new Promise<void>((resolve, reject) => {
      execFile(
        "npx",
        ["-y", "hyperframes", "transcribe", audioFile, "-d", dir, "--json", "--model", "small.en"],
        { timeout: 240_000, maxBuffer: 20 * 1024 * 1024 },
        (err) => (err ? reject(err) : resolve()),
      );
    });
    const words = JSON.parse(await readFile(path.join(dir, "transcript.json"), "utf8")) as {
      text: string;
      start: number;
      end: number;
    }[];
    return words.map((w) => ({ word: w.text, start: w.start, end: w.end }));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
