import { NextResponse } from "next/server";
import { z } from "zod";
import { researchProduct } from "@/lib/claude";
import { UnsafeUrlError } from "@/lib/safe-fetch";
import { scrapeSite } from "@/lib/scrape";

export const maxDuration = 300;

const Body = z.object({ url: z.string().min(4).max(2000) });

export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Send a JSON body with a url." }, { status: 400 });

  let url = parsed.data.url.trim();
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  try {
    const site = await scrapeSite(url);
    return NextResponse.json({ research: await researchProduct(site) });
  } catch (err) {
    const status = err instanceof UnsafeUrlError ? 400 : 500;
    console.error("research failed:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Research failed." }, { status });
  }
}
