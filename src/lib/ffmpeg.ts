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

export type Shot =
  | { start: number; end: number; kind: "video" } // a slice of the talking-head video
  | { start: number; end: number; kind: "image"; file: string };

function escapeFilterPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

// Builds the ffmpeg arguments that cut shots together over the voiceover and
// burn in the captions. Exported separately so it can be unit tested.
export function buildComposeArgs(opts: {
  shots: Shot[];
  audioFile: string;
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

  const fill = `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1`;
  const shotLabels: string[] = [];
  let headCursor = 0;
  opts.shots.forEach((shot, i) => {
    const dur = Math.max(0.1, shot.end - shot.start);
    const label = `s${i}`;
    if (shot.kind === "video") {
      filters.push(
        `[${headLabels[headCursor++]}]trim=start=${shot.start.toFixed(3)}:end=${shot.end.toFixed(3)},setpts=PTS-STARTPTS,fps=${fps},${fill}[${label}]`,
      );
    } else {
      inputs.push("-i", shot.file);
      const idx = nextInput++;
      const frames = Math.max(1, Math.round(dur * fps));
      // Slow push-in ("Ken Burns"), alternating direction per shot.
      const zoom = i % 2 === 0 ? `1+0.12*on/${frames}` : `1.12-0.12*on/${frames}`;
      filters.push(
        `[${idx}:v]scale=${Math.round(W * 1.25)}:${Math.round(H * 1.25)}:force_original_aspect_ratio=increase,crop=${Math.round(W * 1.25)}:${Math.round(H * 1.25)},` +
          `zoompan=z='${zoom}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${W}x${H}:fps=${fps},setsar=1[${label}]`,
      );
    }
    shotLabels.push(`[${label}]`);
  });

  filters.push(`${shotLabels.join("")}concat=n=${shotLabels.length}:v=1:a=0[cat]`);
  filters.push(
    `[cat]ass='${escapeFilterPath(opts.assFile)}':fontsdir='${escapeFilterPath(opts.fontsDir)}',format=yuv420p[out]`,
  );

  inputs.push("-i", opts.audioFile);
  const audioIdx = nextInput++;

  return [
    ...inputs,
    "-filter_complex",
    filters.join(";"),
    "-map",
    "[out]",
    "-map",
    `${audioIdx}:a`,
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
