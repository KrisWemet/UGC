import { describe, expect, it } from "vitest";
import { buildAss, chunkWords } from "@/lib/captions";
import { newJob } from "@/lib/job";
import { parseTaskRecord } from "@/lib/kie";
import { assetsReady, buildShots } from "@/lib/render";
import { assertPublicUrl, isPrivateAddress, UnsafeUrlError } from "@/lib/safe-fetch";
import { estimateWordTimings, joinNarration, parseWordTimestamps, segmentTimings } from "@/lib/timing";
import type { Script } from "@/lib/types";

const script: Script = {
  title: "Test",
  angle: "time saver",
  hookText: "Stop doing this",
  actorDescription: "a 28 year old woman with curly hair in a grey hoodie",
  caption: "Try it #ad",
  hashtags: ["#ad"],
  hookVariants: [{ line: "Nobody talks about this shortcut.", hookText: "The shortcut" }],
  segments: [
    { kind: "hook", narration: "Okay stop doing this by hand.", shot: "actor", imagePrompt: null, siteImageIndex: null, onScreenText: null },
    { kind: "problem", narration: "Spreadsheets everywhere, nothing adds up.", shot: "visual", imagePrompt: "messy desk", siteImageIndex: null, onScreenText: null },
    { kind: "cta", narration: "Link in bio.", shot: "actor", imagePrompt: null, siteImageIndex: null, onScreenText: null },
  ],
};

describe("timing", () => {
  it("records where each segment starts in the joined narration", () => {
    const j = joinNarration(script.segments);
    expect(j.text).toBe("Okay stop doing this by hand. Spreadsheets everywhere, nothing adds up. Link in bio.");
    expect(j.wordStarts).toEqual([0, 6, 11]);
    expect(j.wordCount).toBe(14);
  });

  it("estimates word timings that span the audio exactly", () => {
    const words = estimateWordTimings("one two three.", 3);
    expect(words).toHaveLength(3);
    expect(words[0].start).toBe(0);
    expect(words[2].end).toBeCloseTo(3);
    expect(words[2].end - words[2].start).toBeGreaterThan(words[0].end - words[0].start);
  });

  it("parses word lists and ElevenLabs character alignment", () => {
    expect(parseWordTimestamps({ words: [{ text: "hi", start: 0, end: 0.4 }] })).toEqual([
      { word: "hi", start: 0, end: 0.4 },
    ]);
    const fromChars = parseWordTimestamps({
      alignment: {
        characters: ["h", "i", " ", "y", "o"],
        character_start_times_seconds: [0, 0.1, 0.2, 0.3, 0.4],
        character_end_times_seconds: [0.1, 0.2, 0.3, 0.4, 0.5],
      },
    });
    expect(fromChars).toEqual([
      { word: "hi", start: 0, end: 0.2 },
      { word: "yo", start: 0.3, end: 0.5 },
    ]);
    expect(parseWordTimestamps({ resultUrls: ["x"] })).toBeNull();
  });

  it("derives segment boundaries that cover the whole duration", () => {
    const { text, wordStarts, wordCount } = joinNarration(script.segments);
    const words = estimateWordTimings(text, 10);
    const segs = segmentTimings(words, wordStarts, wordCount, 10);
    expect(segs[0].start).toBe(0);
    expect(segs.at(-1)!.end).toBe(10);
    for (let i = 1; i < segs.length; i++) expect(segs[i].start).toBe(segs[i - 1].end);
  });
});

describe("captions", () => {
  it("chunks words and breaks at punctuation", () => {
    const words = estimateWordTimings("Okay so. I found this tool today", 4);
    expect(chunkWords(words).map((c) => c.word)).toEqual(["Okay so.", "I found this", "tool today"]);
  });

  it("escapes ASS markup and includes hook and label", () => {
    const ass = buildAss({
      words: [{ word: "{bad}\\word", start: 0, end: 1 }],
      hookText: "Hook",
      hookEnd: 1,
      duration: 2,
      aiLabel: true,
    });
    expect(ass).toContain("BADWORD");
    expect(ass).toContain(",Hook,,0,0,0,,HOOK");
    expect(ass).toContain("AI-GENERATED");
  });
});

describe("safe-fetch", () => {
  it("flags private and metadata addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "169.254.169.254", "192.168.0.1", "172.20.0.1", "::1", "fd00::1", "::ffff:10.0.0.1"]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    for (const ip of ["8.8.8.8", "1.1.1.1", "2606:4700::1111"]) expect(isPrivateAddress(ip), ip).toBe(false);
  });

  it("rejects non-http and internal URLs", async () => {
    await expect(assertPublicUrl("file:///etc/passwd")).rejects.toBeInstanceOf(UnsafeUrlError);
    await expect(assertPublicUrl("http://169.254.169.254/latest")).rejects.toBeInstanceOf(UnsafeUrlError);
    await expect(assertPublicUrl("http://user:pw@example.com")).rejects.toBeInstanceOf(UnsafeUrlError);
  });
});

describe("kie task parsing", () => {
  it("reads result URLs and failures", () => {
    expect(parseTaskRecord({ state: "success", resultJson: '{"resultUrls":["https://x/a.png"]}' }).urls).toEqual([
      "https://x/a.png",
    ]);
    const failed = parseTaskRecord({ state: "fail", resultJson: null, failMsg: "nsfw" });
    expect(failed.error).toBe("nsfw");
    expect(parseTaskRecord({ state: "generating", resultJson: "not json" }).urls).toEqual([]);
  });
});

describe("render job", () => {
  const job = newJob({ mode: "actor", quality: "budget", voiceId: "v", aiLabel: true, script, siteImages: [] });

  it("creates one visual per visual segment", () => {
    expect(job.visuals.map((v) => v.segment)).toEqual([1]);
    expect(assetsReady(job)).toBe(false);
  });

  it("maps segments to talking-head slices and images", () => {
    const ready = structuredClone(job);
    ready.voice.segments = [
      { start: 0, end: 2 },
      { start: 2, end: 5 },
      { start: 5, end: 6 },
    ];
    const shots = buildShots(ready, new Map([[1, "/tmp/img.jpg"]]));
    expect(shots.map((s) => s.kind)).toEqual(["video", "image", "video"]);
    expect(shots[1]).toMatchObject({ start: 2, end: 5, file: "/tmp/img.jpg" });
  });
});

describe("voices", async () => {
  const { parseVoice, fallbackGeminiVoice } = await import("@/lib/voices");
  it("parses provider prefixes and treats bare IDs as ElevenLabs", () => {
    expect(parseVoice("gemini:Zephyr")).toEqual({ provider: "gemini", voice: "Zephyr" });
    expect(parseVoice("elevenlabs:abc")).toEqual({ provider: "elevenlabs", voice: "abc" });
    expect(parseVoice("kPzsL2i3teMYv0FxEYQ6")).toEqual({ provider: "elevenlabs", voice: "kPzsL2i3teMYv0FxEYQ6" });
  });
  it("picks a fallback voice by the creator's gender", () => {
    expect(fallbackGeminiVoice("a 28-year-old woman with curly hair")).toBe("gemini:Zephyr");
    expect(fallbackGeminiVoice("a 30 year old man in a hoodie")).toBe("gemini:Puck");
  });
});

describe("json replies", async () => {
  const { extractJson, jsonReply } = await import("@/lib/json-reply");
  const { z } = await import("zod");
  it("extracts JSON from fenced or chatty replies", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Sure! {"a":2} Hope that helps.')).toEqual({ a: 2 });
  });
  it("retries once with the validation error", async () => {
    const replies = ['{"word": 5}', '{"word": "joy"}'];
    const seen: number[] = [];
    const result = await jsonReply(
      async (_system, messages) => {
        seen.push(messages.length);
        return replies.shift()!;
      },
      z.object({ word: z.string() }),
      "system",
      "user",
    );
    expect(result).toEqual({ word: "joy" });
    expect(seen).toEqual([1, 3]);
  });
});

describe("editing", async () => {
  const { splitForJumpCuts, buildShots: shots, buildStickers } = await import("@/lib/render");
  it("splits long talking-head stretches into ~2s shots", () => {
    expect(splitForJumpCuts(0, 1.5)).toEqual([{ start: 0, end: 1.5 }]);
    const parts = splitForJumpCuts(0, 6.6);
    expect(parts).toHaveLength(3);
    expect(parts.at(-1)!.end).toBe(6.6);
  });
  it("alternates punch-ins and prefers animated clips over stills", () => {
    const job = newJob({ mode: "actor", quality: "budget", voiceId: "v", aiLabel: true, script, siteImages: [] });
    job.voice.segments = [
      { start: 0, end: 4.4 },
      { start: 4.4, end: 7 },
      { start: 7, end: 8 },
    ];
    job.script.segments[1].onScreenText = "No more spreadsheets";
    const result = shots(job, new Map([[1, "/tmp/a.jpg"]]), new Map([[1, "/tmp/a.mp4"]]));
    expect(result.map((s) => s.kind)).toEqual(["video", "video", "clip", "video"]);
    expect(result.filter((s) => s.kind === "video").map((s) => (s as { zoom?: number }).zoom)).toEqual([1, 1.18, 1]);
    const [sticker, ...rest] = buildStickers(job);
    expect(rest).toEqual([]);
    expect(sticker.text).toBe("No more spreadsheets");
    expect(sticker.start).toBeCloseTo(4.55);
    expect(sticker.end).toBeCloseTo(6.4);
  });
});

describe("hook variants", async () => {
  const { variantJob } = await import("@/lib/job");
  it("swaps only the hook and reuses finished assets", () => {
    const parent = newJob({ mode: "actor", quality: "premium", voiceId: "gemini:Puck", aiLabel: true, script, siteImages: [] });
    parent.status = "done";
    parent.actor.url = "https://x/actor.png";
    parent.holding.url = "https://x/holding.png";
    parent.track.url = "https://x/music.mp3";
    parent.visuals[0].url = "https://x/b.jpg";
    parent.visuals[0].clip.url = "https://x/b.mp4";
    parent.head.url = "https://x/head.mp4";
    const v = variantJob(parent, script.hookVariants[0]);
    expect(v.id).not.toBe(parent.id);
    expect(v.status).toBe("running");
    expect(v.script.segments[0].narration).toBe("Nobody talks about this shortcut.");
    expect(v.script.segments.slice(1)).toEqual(parent.script.segments.slice(1));
    expect(v.actor.url).toBe(parent.actor.url);
    expect(v.holding.url).toBe(parent.holding.url);
    expect(v.track.url).toBe(parent.track.url);
    expect(v.visuals[0]).toMatchObject({ url: "https://x/b.jpg", clip: { url: "https://x/b.mp4" } });
    expect(v.head.url).toBeNull();
    expect(v.voice.url).toBeNull();
  });
});
