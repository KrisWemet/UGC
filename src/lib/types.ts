import { z } from "zod";

// ── Research output ────────────────────────────────────────────────────────

export const ProductBriefSchema = z.object({
  productName: z.string(),
  oneLiner: z.string(),
  category: z.string(),
  targetAudience: z.array(z.string()),
  painPoints: z.array(
    z.object({
      pain: z.string(),
      source: z.enum(["website", "reviews", "forums", "inferred"]),
    }),
  ),
  keyFeatures: z.array(z.string()),
  differentiators: z.array(z.string()),
  // Only claims a viewer could verify on the site or in cited sources.
  verifiableClaims: z.array(z.string()),
  pricing: z.string(),
  competitors: z.array(z.string()),
  hookIdeas: z.array(z.string()),
  angles: z.array(z.object({ angle: z.string(), whyItWorks: z.string() })),
});
export type ProductBrief = z.infer<typeof ProductBriefSchema>;

export type SiteImage = { url: string; alt: string };
export type Source = { title: string; url: string };

export type Research = {
  url: string;
  brief: ProductBrief;
  images: SiteImage[];
  sources: Source[];
};

// ── Scripts ────────────────────────────────────────────────────────────────

export const VideoModeSchema = z.enum(["actor", "faceless"]);
export type VideoMode = z.infer<typeof VideoModeSchema>;

export const SegmentSchema = z.object({
  kind: z.enum(["hook", "problem", "solution", "demo", "proof", "cta"]),
  narration: z.string(),
  // actor: the AI creator is on screen. visual: a still with a slow zoom.
  shot: z.enum(["actor", "visual"]),
  // Prompt for a generated image. Required for visual shots; also the fallback
  // if a chosen site image cannot be downloaded.
  imagePrompt: z.string().nullable(),
  // Index into the scraped site images, when a real product image fits better.
  siteImageIndex: z.number().int().nullable(),
});
export type Segment = z.infer<typeof SegmentSchema>;

export const ScriptSchema = z.object({
  title: z.string(),
  angle: z.string(),
  hookText: z.string(),
  segments: z.array(SegmentSchema),
  actorDescription: z.string(),
  caption: z.string(),
  hashtags: z.array(z.string()),
});
export type Script = z.infer<typeof ScriptSchema>;
