import { NextResponse } from "next/server";
import { z } from "zod";
import { newJob, RenderJobSchema } from "@/lib/job";
import { advance } from "@/lib/render";
import { ScriptSchema, VideoModeSchema } from "@/lib/types";

// The final compose step runs ffmpeg in this function, so give it room.
export const maxDuration = 300;

const Body = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    mode: VideoModeSchema,
    quality: z.enum(["premium", "budget"]),
    voiceId: z.string().max(100),
    aiLabel: z.boolean(),
    motion: z.boolean().optional(),
    music: z.boolean().optional(),
    script: ScriptSchema,
    siteImages: z.array(z.object({ url: z.string().url(), alt: z.string().max(300) })).max(12),
  }),
  z.object({ action: z.literal("advance"), job: RenderJobSchema }),
]);

export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const body = parsed.data;
  if (body.action === "create") {
    if (body.script.segments.length > 8) {
      return NextResponse.json({ error: "Scripts are limited to 8 segments." }, { status: 400 });
    }
    const { action: _, ...input } = body;
    return NextResponse.json({ job: await advance(newJob(input)) });
  }
  return NextResponse.json({ job: await advance(body.job) });
}
