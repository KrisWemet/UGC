import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import ffmpegStatic from "ffmpeg-static";
import { config } from "./config";

export function ffmpegPath(): string {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  if (ffmpegStatic && existsSync(ffmpegStatic)) return ffmpegStatic;
  return "ffmpeg";
}

export const FONTS_DIR = path.join(process.cwd(), "assets", "fonts");

export function runFfmpeg(args: string[], timeoutMs = 280_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(/*turbopackIgnore: true*/ ffmpegPath(), ["-hide_banner", "-y", ...args]);
    let stderr = "";
    proc.stderr.on("data", (d) => {
      stderr = (stderr + d.toString()).slice(-20_000);
    });
    const timer = setTimeout(() => proc.kill("SIGKILL"), timeoutMs);
    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stderr);
      else reject(new Error(`ffmpeg exited with ${code}: ${stderr.slice(-1500)}`));
    });
  });
}

// Reads a media file's duration from ffmpeg's banner (avoids shipping ffprobe).
export async function mediaDuration(file: string): Promise<number> {
  const out = await runFfmpeg(["-i", file, "-f", "null", "-"]).catch((e: Error) => e.message);
  const matches = [...out.matchAll(/time=(\d+):(\d+):(\d+\.\d+)/g)];
  const last = matches.at(-1) ?? out.match(/Duration: (\d+):(\d+):(\d+\.\d+)/);
  if (!last) throw new Error(`Could not read the duration of ${path.basename(file)}.`);
  return Number(last[1]) * 3600 + Number(last[2]) * 60 + Number(last[3]);
}

// transition: an ffmpeg xfade effect into this shot from the previous one
// (e.g. "smoothleft", "zoomin"). Shots without one hard-cut.
type ShotBase = { start: number; end: number; transition?: string };
export type Shot =
  // A slice of the talking-head video. zoom > 1 punches in (jump-cut style).
  | (ShotBase & { kind: "video"; zoom?: number })
  // A still with a slow push-in.
  | (ShotBase & { kind: "image"; file: string })
  // An animated b-roll clip, played from its start.
  | (ShotBase & { kind: "clip"; file: string });

export const TRANSITION_SECONDS = 0.3;

function escapeFilterPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

// Builds the ffmpeg arguments that cut shots together over the voiceover,
// mix in optional music and burn in the captions. Exported separately so it
// can be unit tested.
export function buildComposeArgs(opts: {
  shots: Shot[];
  audioFile: string;
  musicFile?: string;
  talkingHeadFile?: string;
  assFile: string;
  fontsDir: string;
  duration: number;
  outFile: string;
}): string[] {
  const { width: W, height: H, fps } = config.video;
  const inputs: string[] = [];
  const filters: string[] = [];
  let nextInput = 0;

  const videoShots = opts.shots.filter((s) => s.kind === "video");
  let headLabels: string[] = [];
  if (videoShots.length > 0) {
    if (!opts.talkingHeadFile) throw new Error("Actor shots need a talking-head video.");
    inputs.push("-i", opts.talkingHeadFile);
    const idx = nextInput++;
    headLabels = videoShots.map((_, i) => `th${i}`);
    // Freeze the last frame if the talking head is slightly shorter than the audio.
    filters.push(
      `[${idx}:v]tpad=stop_mode=clone:stop_duration=3,split=${headLabels.length}${headLabels.map((l) => `[${l}]`).join("")}`,
    );
  }

  const fill = (w: number, h: number) => `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}`;
  const shotLabels: string[] = [];
  let headCursor = 0;
  opts.shots.forEach((shot, i) => {
    // A shot followed by a transition runs TRANSITION_SECONDS longer, because
    // the transition overlaps it with the next shot. This keeps every shot
    // starting at its own time, in sync with the voice.
    const overlap = opts.shots[i + 1]?.transition ? TRANSITION_SECONDS : 0;
    const dur = Math.max(0.1, shot.end - shot.start) + overlap;
    const label = `s${i}`;
    if (shot.kind === "video") {
      const zoom = shot.zoom ?? 1;
      const zw = Math.round((W * zoom) / 2) * 2;
      const zh = Math.round((H * zoom) / 2) * 2;
      // Punch-ins crop toward the upper middle, where the face is.
      const crop = zoom > 1 ? `,crop=${W}:${H}:(iw-${W})/2:(ih-${H})*0.35` : "";
      filters.push(
        `[${headLabels[headCursor++]}]trim=start=${shot.start.toFixed(3)}:end=${(shot.start + dur).toFixed(3)},setpts=PTS-STARTPTS,fps=${fps},${fill(zw, zh)}${crop},setsar=1,settb=AVTB,format=yuv420p[${label}]`,
      );
    } else if (shot.kind === "clip") {
      inputs.push("-i", shot.file);
      const idx = nextInput++;
      filters.push(
        `[${idx}:v]tpad=stop_mode=clone:stop_duration=${Math.ceil(dur)},trim=duration=${dur.toFixed(3)},setpts=PTS-STARTPTS,fps=${fps},${fill(W, H)},setsar=1,settb=AVTB,format=yuv420p[${label}]`,
      );
    } else {
      inputs.push("-i", shot.file);
      const idx = nextInput++;
      const frames = Math.max(1, Math.round(dur * fps));
      // Slow push-in ("Ken Burns"), alternating direction per shot.
      const zoom = i % 2 === 0 ? `1+0.12*on/${frames}` : `1.12-0.12*on/${frames}`;
      filters.push(
        `[${idx}:v]${fill(Math.round(W * 1.25), Math.round(H * 1.25))},` +
          `zoompan=z='${zoom}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${W}x${H}:fps=${fps},setsar=1,settb=AVTB,format=yuv420p[${label}]`,
      );
    }
    shotLabels.push(`[${label}]`);
  });

  // Hard-cut runs of shots are concatenated into groups; groups are joined
  // with xfade transitions.
  const groups: { labels: string[]; start: number }[] = [];
  opts.shots.forEach((shot, i) => {
    if (i === 0 || shot.transition) groups.push({ labels: [], start: shot.start });
    groups[groups.length - 1].labels.push(shotLabels[i]);
  });
  const groupLabels = groups.map((g, gi) => {
    if (g.labels.length === 1) return g.labels[0];
    filters.push(`${g.labels.join("")}concat=n=${g.labels.length}:v=1:a=0[g${gi}]`);
    return `[g${gi}]`;
  });
  let current = groupLabels[0];
  const origin = opts.shots[0]?.start ?? 0;
  groups.slice(1).forEach((g, k) => {
    const shotIndex = opts.shots.findIndex((s) => s.start === g.start && s.transition);
    const effect = opts.shots[shotIndex]?.transition ?? "fade";
    // The previous group was extended by TRANSITION_SECONDS, so starting the
    // transition at this group's own start time keeps it on schedule.
    const offset = g.start - origin;
    const out = `[x${k}]`;
    filters.push(
      `${current}${groupLabels[k + 1]}xfade=transition=${effect}:duration=${TRANSITION_SECONDS}:offset=${offset.toFixed(3)}${out}`,
    );
    current = out;
  });
  filters.push(`${current}null[cat]`);
  filters.push(
    `[cat]ass='${escapeFilterPath(opts.assFile)}':fontsdir='${escapeFilterPath(opts.fontsDir)}',format=yuv420p[out]`,
  );

  inputs.push("-i", opts.audioFile);
  const voiceIdx = nextInput++;
  let audioMap = `${voiceIdx}:a`;
  if (opts.musicFile) {
    inputs.push("-i", opts.musicFile);
    const musicIdx = nextInput++;
    const fadeStart = Math.max(0, opts.duration - 1.2).toFixed(3);
    // Music sits well under the voice and fades out at the end.
    filters.push(
      `[${musicIdx}:a]atrim=duration=${opts.duration.toFixed(3)},volume=0.14,afade=t=in:d=0.3,afade=t=out:st=${fadeStart}:d=1.2[bg]`,
      `[${voiceIdx}:a]aresample=44100[vo]`,
      `[vo][bg]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[aout]`,
    );
    audioMap = "[aout]";
  }

  return [
    ...inputs,
    "-filter_complex",
    filters.join(";"),
    "-map",
    "[out]",
    "-map",
    audioMap,
    "-t",
    opts.duration.toFixed(3),
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "21",
    "-r",
    String(fps),
    "-c:a",
    "aac",
    "-b:a",
    "160k",
    "-movflags",
    "+faststart",
    "-metadata",
    "comment=AI-generated video (synthetic voice and imagery)",
    opts.outFile,
  ];
}
