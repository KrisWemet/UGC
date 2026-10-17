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
});

export const RenderJobSchema = z.object({
  id: z.string().max(100),
  mode: VideoModeSchema,
  quality: z.enum(["premium", "budget"]),
  voiceId: z.string().max(100),
  aiLabel: z.boolean(),
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
  visuals: z
    .array(
      TaskRef.extend({
        segment: z.number().int(),
        source: z.enum(["site", "generated"]),
      }),
    )
    .max(20),
  final: z.object({ url: z.string().url(), expires: z.boolean() }).nullable(),
});
export type RenderJob = z.infer<typeof RenderJobSchema>;

export function newJob(input: {
  mode: RenderJob["mode"];
  quality: RenderJob["quality"];
  voiceId: string;
  aiLabel: boolean;
  script: RenderJob["script"];
  siteImages: RenderJob["siteImages"];
}): RenderJob {
  const empty = { taskId: null, url: null, attempts: 0 };
  return {
    id: crypto.randomUUID(),
    ...input,
    voiceId: resolveVoice(input.voiceId, input.script.actorDescription),
    status: "running",
    error: null,
    log: [],
    voice: { ...empty, duration: null, words: null, segments: null, timestampsEstimated: false },
    actor: { ...empty },
    head: { ...empty },
    visuals: input.script.segments.flatMap((seg, i) =>
      seg.shot === "visual"
        ? [{ ...empty, segment: i, source: seg.siteImageIndex !== null ? ("site" as const) : ("generated" as const) }]
        : [],
    ),
    final: null,
  };
}
