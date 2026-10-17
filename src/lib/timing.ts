// Turns a voiceover into a timeline: when each word is spoken (for captions)
// and when each script segment starts and ends (for cutting visuals).

export type WordTiming = { word: string; start: number; end: number };
export type SegmentTiming = { start: number; end: number };

// Builds the narration sent to TTS and records where each segment's text
// begins, so word timings can be mapped back to segments.
export function joinNarration(segments: { narration: string }[]) {
  const parts = segments.map((s) => s.narration.trim().replace(/\s+/g, " "));
  const wordStarts: number[] = [];
  let count = 0;
  for (const p of parts) {
    wordStarts.push(count);
    count += p.split(" ").filter(Boolean).length;
  }
  return { text: parts.join(" "), wordStarts, wordCount: count };
}

// Parses word timestamps from a TTS result if the provider returned any. kie.ai's
// docs don't pin down the shape, so accept the common ones: a list of
// {word|text, start|start_time, end|end_time}, or ElevenLabs' character alignment.
export function parseWordTimestamps(result: unknown): WordTiming[] | null {
  if (!result || typeof result !== "object") return null;
  const obj = result as Record<string, unknown>;

  for (const key of ["words", "timestamps", "word_timestamps", "wordTimestamps"]) {
    const list = obj[key];
    if (Array.isArray(list) && list.length > 0) {
      const words = list
        .map((w) => {
          const r = w as Record<string, unknown>;
          const word = String(r.word ?? r.text ?? "").trim();
          const start = Number(r.start ?? r.start_time ?? r.startTime);
          const end = Number(r.end ?? r.end_time ?? r.endTime);
          return { word, start, end };
        })
        .filter((w) => w.word && Number.isFinite(w.start) && Number.isFinite(w.end));
      if (words.length > 0) return words;
    }
  }

  const alignment = (obj.alignment ?? obj.normalized_alignment) as Record<string, unknown> | undefined;
  if (alignment && Array.isArray(alignment.characters)) {
    return wordsFromCharacters(
      alignment.characters as string[],
      alignment.character_start_times_seconds as number[],
      alignment.character_end_times_seconds as number[],
    );
  }
  for (const value of Object.values(obj)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const nested = parseWordTimestamps(value);
      if (nested) return nested;
    }
  }
  return null;
}

function wordsFromCharacters(chars: string[], starts: number[], ends: number[]): WordTiming[] {
  const words: WordTiming[] = [];
  let current: WordTiming | null = null;
  chars.forEach((ch, i) => {
    if (/\s/.test(ch)) {
      if (current) words.push(current);
      current = null;
      return;
    }
    if (!current) current = { word: "", start: starts[i], end: ends[i] };
    current.word += ch;
    current.end = ends[i];
  });
  if (current) words.push(current);
  return words;
}

// Fallback when no timestamps are available: spread words over the audio in
// proportion to their length, with a little weight for punctuation pauses.
export function estimateWordTimings(text: string, duration: number): WordTiming[] {
  const words = text.split(/\s+/).filter(Boolean);
  const weights = words.map((w) => w.length + 2 + (/[.!?]$/.test(w) ? 4 : /[,;:]$/.test(w) ? 2 : 0));
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  let t = 0;
  return words.map((word, i) => {
    const span = (weights[i] / total) * duration;
    const timing = { word, start: t, end: t + span };
    t += span;
    return timing;
  });
}

// Segment boundaries from word timings. If the provider's word count differs
// from ours (it may split or merge tokens), scale the indices proportionally.
export function segmentTimings(
  words: WordTiming[],
  wordStarts: number[],
  wordCount: number,
  duration: number,
): SegmentTiming[] {
  const scale = words.length / Math.max(wordCount, 1);
  const starts = wordStarts.map((idx, i) => {
    if (i === 0) return 0;
    const w = words[Math.min(words.length - 1, Math.round(idx * scale))];
    return w ? w.start : 0;
  });
  return starts.map((start, i) => ({ start, end: i + 1 < starts.length ? starts[i + 1] : duration }));
}
