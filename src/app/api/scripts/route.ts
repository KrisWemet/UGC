import { NextResponse } from "next/server";
import { z } from "zod";
import { generateScripts } from "@/lib/llm";
import { ProductBriefSchema, VideoModeSchema } from "@/lib/types";

export const maxDuration = 300;

const Body = z.object({
  research: z.object({
    url: z.string().url(),
    brief: ProductBriefSchema,
    images: z.array(z.object({ url: z.string().url(), alt: z.string() })).max(12),
    sources: z.array(z.object({ title: z.string(), url: z.string() })).max(30),
  }),
  mode: VideoModeSchema,
  count: z.number().int().min(1).max(5),
});

export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const { research, mode, count } = parsed.data;
  try {
    return NextResponse.json({ scripts: await generateScripts(research, mode, count) });
  } catch (err) {
    console.error("script generation failed:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Script generation failed." }, { status: 500 });
  }
}
