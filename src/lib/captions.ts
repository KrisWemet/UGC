import type { WordTiming } from "./timing";

// Builds an ASS subtitle file: TikTok-style word captions, an on-screen hook,
// and a small "AI-generated" label. Rendered by ffmpeg's libass.

export const CAPTION_FONT = "Anton";

function assTime(seconds: number): string {
  const s = Math.max(0, seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const cs = Math.floor((s - Math.floor(s)) * 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

// Strips characters that ASS treats as markup.
function assText(text: string): string {
  return text.replace(/[{}\\]/g, "").replace(/\r?\n/g, " ");
}

// Groups words into short caption chunks, breaking early at sentence ends.
export function chunkWords(words: WordTiming[], maxWords = 3): WordTiming[] {
  const chunks: WordTiming[] = [];
  let group: WordTiming[] = [];
  const flush = () => {
    if (group.length === 0) return;
    chunks.push({
      word: group.map((w) => w.word).join(" "),
      start: group[0].start,
      end: group[group.length - 1].end,
    });
    group = [];
  };
  for (const w of words) {
    group.push(w);
    if (group.length >= maxWords || /[.!?,]$/.test(w.word)) flush();
  }
  flush();
  // Close gaps so a caption stays up until the next one starts.
  for (let i = 0; i < chunks.length - 1; i++) {
    if (chunks[i + 1].start - chunks[i].end < 0.4) chunks[i].end = chunks[i + 1].start;
  }
  return chunks;
}

export type Sticker = { text: string; start: number; end: number };

export function buildAss(opts: {
  words: WordTiming[];
  hookText: string;
  hookEnd: number;
  duration: number;
  aiLabel: boolean;
  stickers?: Sticker[];
}): string {
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caption,${CAPTION_FONT},96,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,1,0,1,6,2,2,80,80,560,1
Style: Hook,${CAPTION_FONT},84,&H00000000,&H000000FF,&H00FFFFFF,&H00FFFFFF,0,0,0,0,100,100,1,0,3,18,0,8,90,90,260,1
Style: Sticker,${CAPTION_FONT},92,&H00141414,&H000000FF,&H0000E1FF,&H00000000,0,0,0,0,100,100,1,0,3,22,0,5,80,80,0,1
Style: Label,${CAPTION_FONT},34,&H90FFFFFF,&H000000FF,&H80000000,&H00000000,0,0,0,0,100,100,1,0,1,2,0,7,40,40,60,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  const lines: string[] = [];
  if (opts.hookText.trim()) {
    lines.push(`Dialogue: 1,${assTime(0)},${assTime(opts.hookEnd)},Hook,,0,0,0,,${assText(opts.hookText.toUpperCase())}`);
  }
  for (const c of chunkWords(opts.words)) {
    const text = assText(c.word.replace(/[.,!?;:]+$/g, "").toUpperCase());
    // Numbers are the hook of most ads: show those chunks in yellow.
    const color = /\d/.test(text) ? "\\c&H0000E1FF&" : "";
    // Pop-in: start at 80% scale and grow to full size over 80ms.
    lines.push(
      `Dialogue: 0,${assTime(c.start)},${assTime(c.end)},Caption,,0,0,0,,{\\fscx80\\fscy80\\t(0,80,\\fscx100\\fscy100)${color}}${text}`,
    );
  }
  // Pop-up stickers: tilted yellow labels that overshoot then settle. They sit
  // near the top, above the creator's head and below the TikTok header, and
  // take the hook's spot once the hook is gone.
  (opts.stickers ?? []).forEach((s, i) => {
    const tilt = i % 2 === 0 ? -4 : 3;
    const pop = "\\fscx40\\fscy40\\t(0,120,\\fscx112\\fscy112)\\t(120,200,\\fscx100\\fscy100)";
    lines.push(
      `Dialogue: 3,${assTime(s.start)},${assTime(s.end)},Sticker,,0,0,0,,{\\an5\\pos(540,330)\\frz${tilt}${pop}}${assText(s.text.toUpperCase())}`,
    );
  });
  if (opts.aiLabel) {
    lines.push(`Dialogue: 2,${assTime(0)},${assTime(opts.duration)},Label,,0,0,0,,AI-GENERATED`);
  }
  return header + lines.join("\n") + "\n";
}
