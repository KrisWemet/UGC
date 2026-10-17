import { mkdtempSync, writeFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildAss } from "@/lib/captions";
import { buildComposeArgs, FONTS_DIR, mediaDuration, runFfmpeg } from "@/lib/ffmpeg";
import { estimateWordTimings } from "@/lib/timing";

// End-to-end check of the real ffmpeg pipeline with synthetic inputs:
// a talking-head stand-in, two stills, a tone for audio and burned captions.
describe("compose", () => {
  it("renders a 1080x1920 video with captions over the full audio", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ugc-compose-"));
    const head = path.join(dir, "head.mp4");
    const img1 = path.join(dir, "a.png");
    const img2 = path.join(dir, "b.jpg");
    const audio = path.join(dir, "voice.mp3");
    await runFfmpeg(["-f", "lavfi", "-i", "testsrc2=size=720x1280:rate=25:duration=9", "-pix_fmt", "yuv420p", head]);
    await runFfmpeg(["-f", "lavfi", "-i", "color=c=orange:size=1024x1536", "-frames:v", "1", img1]);
    await runFfmpeg(["-f", "lavfi", "-i", "color=c=teal:size=1600x900", "-frames:v", "1", img2]);
    await runFfmpeg(["-f", "lavfi", "-i", "sine=frequency=440:duration=9", "-c:a", "libmp3lame", audio]);

    const duration = await mediaDuration(audio);
    expect(duration).toBeGreaterThan(8.5);

    const text = "Okay so I just found this tool. It fixes the thing. Link in bio, go try it!";
    const ass = path.join(dir, "subs.ass");
    writeFileSync(
      ass,
      buildAss({ words: estimateWordTimings(text, duration), hookText: "Wait for it", hookEnd: 2, duration, aiLabel: true }),
    );

    const out = path.join(dir, "final.mp4");
    await runFfmpeg(
      buildComposeArgs({
        shots: [
          { kind: "video", start: 0, end: 2 },
          { kind: "image", start: 2, end: 4, file: img1 },
          { kind: "video", start: 4, end: 6.5 },
          { kind: "image", start: 6.5, end: 8, file: img2 },
          { kind: "video", start: 8, end: duration },
        ],
        audioFile: audio,
        talkingHeadFile: head,
        assFile: ass,
        fontsDir: FONTS_DIR,
        duration,
        outFile: out,
      }),
    );

    expect(statSync(out).size).toBeGreaterThan(50_000);
    expect(Math.abs((await mediaDuration(out)) - duration)).toBeLessThan(0.3);
    const info = await runFfmpeg(["-i", out, "-f", "null", "-t", "0.1", "-"]);
    expect(info).toMatch(/1080x1920/);
  });
});
