import * as cheerio from "cheerio";
import { safeFetch } from "./safe-fetch";
import type { SiteImage } from "./types";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";
const SUBPAGE_HINTS = ["pricing", "features", "about", "product", "how-it-works", "use-case", "shop"];

export type ScrapedSite = {
  url: string;
  title: string;
  description: string;
  headings: string[];
  text: string;
  extraPages: { url: string; text: string }[];
  images: SiteImage[];
};

async function fetchHtml(url: string): Promise<string | null> {
  const res = await safeFetch(url, { headers: { "user-agent": UA, accept: "text/html" }, timeoutMs: 20_000 });
  if (!res.ok || !(res.headers.get("content-type") ?? "").includes("html")) return null;
  return (await res.text()).slice(0, 2_000_000);
}

function pageText($: cheerio.CheerioAPI, limit: number): string {
  $("script, style, noscript, svg, iframe, nav, footer").remove();
  return $("body").text().replace(/\s+/g, " ").trim().slice(0, limit);
}

export function extractImages($: cheerio.CheerioAPI, base: string): SiteImage[] {
  const seen = new Set<string>();
  const images: SiteImage[] = [];
  const add = (src: string | undefined, alt: string) => {
    if (!src || src.startsWith("data:")) return;
    let abs: string;
    try {
      abs = new URL(src, base).toString();
    } catch {
      return;
    }
    if (/\.(svg|gif|ico)(\?|$)/i.test(abs) || /(logo|icon|favicon|sprite|avatar|badge)/i.test(abs)) return;
    if (seen.has(abs)) return;
    seen.add(abs);
    images.push({ url: abs, alt: alt.trim().slice(0, 140) });
  };
  add($('meta[property="og:image"]').attr("content"), "Social preview image");
  add($('meta[name="twitter:image"]').attr("content"), "Social preview image");
  $("img").each((_, el) => {
    const img = $(el);
    const width = Number(img.attr("width") ?? 0);
    if (width && width < 200) return;
    const src = img.attr("src") ?? img.attr("data-src") ?? img.attr("srcset")?.split(/\s+/)[0];
    add(src, img.attr("alt") ?? "");
  });
  return images.slice(0, 8);
}

export async function scrapeSite(url: string): Promise<ScrapedSite> {
  const html = await fetchHtml(url);
  if (!html) throw new Error(`Could not load ${url} as a web page.`);
  const $ = cheerio.load(html);

  const title = $("title").first().text().trim();
  const description =
    $('meta[name="description"]').attr("content") ?? $('meta[property="og:description"]').attr("content") ?? "";
  const headings = $("h1, h2, h3")
    .map((_, el) => $(el).text().replace(/\s+/g, " ").trim())
    .get()
    .filter((h) => h && h.length < 200)
    .slice(0, 25);
  const images = extractImages($, url);

  const host = new URL(url).host;
  const subpages = new Set<string>();
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    if (!SUBPAGE_HINTS.some((hint) => href.toLowerCase().includes(hint))) return;
    try {
      const abs = new URL(href, url);
      abs.hash = "";
      if (abs.host === host && abs.toString() !== url) subpages.add(abs.toString());
    } catch {}
  });

  const text = pageText($, 12_000);
  const extraPages: { url: string; text: string }[] = [];
  for (const sub of [...subpages].slice(0, 3)) {
    try {
      const subHtml = await fetchHtml(sub);
      if (subHtml) extraPages.push({ url: sub, text: pageText(cheerio.load(subHtml), 5_000) });
    } catch {
      // A broken subpage shouldn't sink the whole research step.
    }
  }

  return { url, title, description, headings, text, extraPages, images };
}
