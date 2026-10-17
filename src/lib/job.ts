import { z } from "zod";
import { ScriptSchema, VideoModeSchema } from "./types";
import { resolveVoice } from "./voices";

// A render job is plain JSON that the browser keeps and sends back on every
// step, so the server stays stateless and a page reload can resume a job.

const TaskRef = z.object({
  taskId: z.string().max(200).nullable(),
  url: z.string().url().max(2000).nullable(),
  // Failed attempts so far; kie.ai tasks sometimes fail with transient errors.
  attempts: z.number().int().min(0).max(10).default(0),
  // Optional extras (motion, music) are skipped rather than failing the video.
  skipped: z.boolean().default(false),
});

export const RenderJobSchema = z.object({
  id: z.string().max(100),
  mode: VideoModeSchema,
  quality: z.enum(["premium", "budget"]),
  voiceId: z.string().max(100),
  aiLabel: z.boolean(),
  // Animate b-roll stills into clips, and add background music.
  motion: z.boolean().default(true),
  music: z.boolean().default(true),
  // Show the creator holding the product (actor mode).
  productInHand: z.boolean().default(true),
  script: ScriptSchema,
  siteImages: z.array(z.object({ url: z.string().url().max(2000), alt: z.string().max(300) })).max(12),
  status: z.enum(["running", "done", "failed"]),
  error: z.string().nullable(),
  log: z.array(z.string()).max(200),
  voice: TaskRef.extend({
    duration: z.number().nullable(),
    words: z.array(z.object({ word: z.string(), start: z.number(), end: z.number() })).max(2000).nullable(),
    segments: z.array(z.object({ start: z.number(), end: z.number() })).max(20).nullable(),
    timestampsEstimated: z.boolean(),
  }),
  actor: TaskRef,
  head: TaskRef,
  // The creator's portrait edited to hold the product; used for the talking head.
  holding: TaskRef.default({ taskId: null, url: null, attempts: 0, skipped: false }),
  track: TaskRef.default({ taskId: null, url: null, attempts: 0, skipped: false }),
  visuals: z
    .array(
      TaskRef.extend({
        segment: z.number().int(),
        source: z.enum(["site", "generated"]),
        clip: TaskRef.default({ taskId: null, url: null, attempts: 0, skipped: false }),
      }),
    )
    .max(20),
  final: z.object({ url: z.string().url(), expires: z.boolean() }).nullable(),
});
export type RenderJob = z.infer<typeof RenderJobSchema>;

// A hook variant of a finished job: same script except the first line, and it
// reuses the creator, b-roll and music so only the hook differs in the test.
export function variantJob(parent: RenderJob, variant: { line: string; hookText: string }): RenderJob {
  const script = structuredClone(parent.script);
  script.segments[0] = { ...script.segments[0], narration: variant.line };
  script.hookText = variant.hookText;
  script.title = `${parent.script.title} (hook: ${variant.hookText})`;
  const job = newJob({
    mode: parent.mode,
    quality: parent.quality,
    voiceId: parent.voiceId,
    aiLabel: parent.aiLabel,
    motion: parent.motion,
    music: parent.music,
    productInHand: parent.productInHand,
    script,
    siteImages: parent.siteImages,
  });
  const done = (url: string | null) => ({ taskId: null, url, attempts: 0, skipped: !url });
  job.actor = done(parent.actor.url);
  job.holding = parent.holding.url ? done(parent.holding.url) : { ...job.holding, skipped: true };
  job.track = parent.track.url ? done(parent.track.url) : { ...job.track, skipped: true };
  job.visuals = parent.visuals.map((v) => ({
    ...v,
    taskId: null,
    attempts: 0,
    clip: v.clip.url ? done(v.clip.url) : { ...v.clip, taskId: null, skipped: true },
  }));
  return job;
}

export function newJob(input: {
  mode: RenderJob["mode"];
  quality: RenderJob["quality"];
  voiceId: string;
  aiLabel: boolean;
  motion?: boolean;
  music?: boolean;
  productInHand?: boolean;
  script: RenderJob["script"];
  siteImages: RenderJob["siteImages"];
}): RenderJob {
  const empty = { taskId: null, url: null, attempts: 0, skipped: false };
  return {
    id: crypto.randomUUID(),
    ...input,
    motion: input.motion ?? true,
    music: input.music ?? true,
    productInHand: input.productInHand ?? true,
    voiceId: resolveVoice(input.voiceId, input.script.actorDescription),
    status: "running",
    error: null,
    log: [],
    voice: { ...empty, duration: null, words: null, segments: null, timestampsEstimated: false },
    actor: { ...empty },
    head: { ...empty },
    holding: { ...empty, skipped: input.productInHand === false || input.mode !== "actor" },
    track: { ...empty, skipped: input.music === false },
    visuals: input.script.segments.flatMap((seg, i) =>
      seg.shot === "visual"
        ? [
            {
              ...empty,
              segment: i,
              source: seg.siteImageIndex !== null ? ("site" as const) : ("generated" as const),
              clip: { ...empty, skipped: input.motion === false },
            },
          ]
        : [],
    ),
    final: null,
  };
}
