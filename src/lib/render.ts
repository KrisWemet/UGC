import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildAss } from "./captions";
import { config } from "./config";
import { buildComposeArgs, FONTS_DIR, mediaDuration, runFfmpeg, type Shot } from "./ffmpeg";
import type { RenderJob } from "./job";
import { createTask, getTask } from "./kie";
import { downloadBuffer, safeFetch } from "./safe-fetch";
import { storeVideo } from "./storage";
import { fallbackGeminiVoice, parseVoice } from "./voices";
import { estimateWordTimings, joinNarration, parseWordTimestamps, segmentTimings } from "./timing";

// Advances a render job by one step: starts tasks that are ready to start,
// polls running ones, and composes the final video once every asset exists.
// Each call is short except the final compose, so it fits serverless limits.

const VOICE_STYLE =
  "A real person in their twenties casually telling a friend about something they just found, speaking to their phone camera. Natural, upbeat and quick, with genuine enthusiasm; not an announcer.";

const AVATAR_PROMPT =
  "A natural UGC creator talking to the camera in a casual home setting. Relaxed, expressive, subtle hand gestures and head movement, natural blinking, steady eye contact.";

function log(job: RenderJob, message: string) {
  job.log = [...job.log, `${new Date().toISOString().slice(11, 19)} ${message}`].slice(-200);
}

function actorPrompt(description: string) {
  return `Vertical smartphone selfie video still of ${description}, looking straight at the camera with a relaxed, friendly expression, upper body framed in the center, sitting in a lived-in apartment with soft window light. Candid and real, not a model shoot. No text.`;
}

const MAX_ATTEMPTS = 3;

// A failed task is started again (up to MAX_ATTEMPTS) before failing the job.
function retryOrFail(job: RenderJob, ref: { taskId: string | null; attempts: number }, what: string, error: string | null) {
  ref.attempts += 1;
  if (ref.attempts >= MAX_ATTEMPTS) throw new Error(`${what} failed after ${ref.attempts} attempts: ${error}`);
  ref.taskId = null;
  log(job, `${what} failed (${error}); retrying.`);
}

function firstUrl(urls: string[], what: string): string {
  if (!urls[0]) throw new Error(`${what} finished but returned no file.`);
  return urls[0];
}

async function stepVoice(job: RenderJob) {
  const { text, wordStarts, wordCount } = joinNarration(job.script.segments);
  const { provider, voice } = parseVoice(job.voiceId);
  if (!job.voice.taskId) {
    job.voice.taskId =
      provider === "gemini"
        ? await createTask(config.kie.geminiTts, {
            speakers: [{ speaker_id: "Speaker 1", voice_name: voice }],
            dialogue_turns: [{ speaker_id: "Speaker 1", style: VOICE_STYLE, text }],
          })
        : await createTask(config.kie.tts, {
            text,
            voice,
            stability: 0.45,
            similarity_boost: 0.75,
            style: 0.35,
            speed: 1.05,
            timestamps: true,
          });
    log(job, `Voiceover started (${provider === "gemini" ? "Google" : "ElevenLabs"} ${voice}).`);
    return;
  }
  if (job.voice.url) return;
  const task = await getTask(job.voice.taskId);
  if (task.state === "fail" && provider === "elevenlabs") {
    // ElevenLabs on kie.ai has outages; switch to a Google voice instead of failing.
    job.voiceId = fallbackGeminiVoice(job.script.actorDescription);
    job.voice.taskId = null;
    log(job, `ElevenLabs voiceover failed (${task.error}); switching to Google voice ${parseVoice(job.voiceId).voice}.`);
    return;
  }
  if (task.state === "fail") return retryOrFail(job, job.voice, "Voiceover", task.error);
  if (task.state !== "success") return;

  const audioUrl =
    task.urls[0] ?? (typeof task.result?.audio_url === "string" ? (task.result.audio_url as string) : null);
  if (!audioUrl) throw new Error("Voiceover finished but returned no audio file.");

  const dir = await mkdtemp(path.join(tmpdir(), "ugc-voice-"));
  try {
    const file = path.join(dir, "voice.audio");
    await writeFile(file, await downloadBuffer(audioUrl, 50 * 1024 * 1024));
    const duration = await mediaDuration(file);
    const parsed = parseWordTimestamps(task.result);
    const words = parsed ?? estimateWordTimings(text, duration);
    job.voice = {
      ...job.voice,
      url: audioUrl,
      duration,
      words,
      segments: segmentTimings(words, wordStarts, wordCount, duration),
      timestampsEstimated: !parsed,
    };
    log(job, `Voiceover ready (${duration.toFixed(1)}s${parsed ? "" : ", caption timing estimated"}).`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function stepActor(job: RenderJob) {
  if (job.mode !== "actor" || job.actor.url) return;
  if (!job.actor.taskId) {
    job.actor.taskId = await createTask(config.kie.image, {
      prompt: actorPrompt(job.script.actorDescription),
      aspect_ratio: "9:16",
      size: "1.5K",
      output_format: "png",
    });
    log(job, "Actor portrait started.");
    return;
  }
  const task = await getTask(job.actor.taskId);
  if (task.state === "fail") return retryOrFail(job, job.actor, "Actor portrait", task.error);
  if (task.state === "success") {
    job.actor.url = firstUrl(task.urls, "Actor portrait");
    log(job, "Actor portrait ready.");
  }
}

async function stepHead(job: RenderJob) {
  if (job.mode !== "actor" || job.head.url || !job.actor.url || !job.voice.url) return;
  if (!job.head.taskId) {
    const premium = job.quality === "premium";
    job.head.taskId = await createTask(premium ? config.kie.avatarPremium : config.kie.avatarBudget, {
      image_url: job.actor.url,
      audio_url: job.voice.url,
      prompt: AVATAR_PROMPT,
      ...(premium ? {} : { resolution: "720p" }),
    });
    log(job, `Talking-head video started (${premium ? "Kling Avatar" : "Infinitalk"}). This usually takes a few minutes.`);
    return;
  }
  const task = await getTask(job.head.taskId);
  if (task.state === "fail") {
    retryOrFail(job, job.head, "Talking-head video", task.error);
    // kie.ai models have separate outages, so retry on the other avatar model.
    job.quality = job.quality === "premium" ? "budget" : "premium";
    return;
  }
  if (task.state === "success") {
    job.head.url = firstUrl(task.urls, "Talking-head video");
    log(job, "Talking-head video ready.");
  }
}

async function siteImageReachable(url: string): Promise<boolean> {
  try {
    const res = await safeFetch(url, { timeoutMs: 15_000 });
    const type = res.headers.get("content-type") ?? "";
    await res.body?.cancel();
    return res.ok && /^image\/(png|jpe?g|webp)/.test(type);
  } catch {
    return false;
  }
}

async function stepVisual(job: RenderJob, visual: RenderJob["visuals"][number]) {
  if (visual.url) return;
  const segment = job.script.segments[visual.segment];
  if (visual.source === "site" && !visual.taskId) {
    const image = segment.siteImageIndex !== null ? job.siteImages[segment.siteImageIndex] : undefined;
    if (image && (await siteImageReachable(image.url))) {
      visual.url = image.url;
      return;
    }
    visual.source = "generated";
    log(job, `Site image for segment ${visual.segment + 1} unavailable; generating one instead.`);
  }
  if (!visual.taskId) {
    visual.taskId = await createTask(config.kie.image, {
      prompt: `${segment.imagePrompt}. Photorealistic, natural light, shot on a phone, vertical framing, no text or logos.`,
      aspect_ratio: "9:16",
      size: "1.5K",
      output_format: "jpeg",
    });
    return;
  }
  const task = await getTask(visual.taskId);
  if (task.state === "fail") return retryOrFail(job, visual, `Image for segment ${visual.segment + 1}`, task.error);
  if (task.state === "success") visual.url = firstUrl(task.urls, "Image");
}

export function buildShots(job: RenderJob, files: Map<number, string>): Shot[] {
  const segments = job.voice.segments!;
  return job.script.segments.map((seg, i) => {
    const { start, end } = segments[i];
    if (seg.shot === "actor" && job.mode === "actor") return { kind: "video" as const, start, end };
    const file = files.get(i);
    if (!file) throw new Error(`Missing image for segment ${i + 1}.`);
    return { kind: "image" as const, start, end, file };
  });
}

async function compose(job: RenderJob) {
  const dir = await mkdtemp(path.join(tmpdir(), "ugc-render-"));
  try {
    log(job, "Composing the final video...");
    const audioFile = path.join(dir, "voice.audio");
    await writeFile(audioFile, await downloadBuffer(job.voice.url!, 50 * 1024 * 1024));

    let talkingHeadFile: string | undefined;
    if (job.mode === "actor") {
      talkingHeadFile = path.join(dir, "head.mp4");
      await writeFile(talkingHeadFile, await downloadBuffer(job.head.url!));
    }

    const files = new Map<number, string>();
    await Promise.all(
      job.visuals.map(async (v) => {
        const file = path.join(dir, `visual-${v.segment}.img`);
        await writeFile(file, await downloadBuffer(v.url!, 30 * 1024 * 1024));
        files.set(v.segment, file);
      }),
    );

    const duration = job.voice.duration!;
    const assFile = path.join(dir, "captions.ass");
    await writeFile(
      assFile,
      buildAss({
        words: job.voice.words!,
        hookText: job.script.hookText,
        hookEnd: Math.min(job.voice.segments![0].end, 3.5),
        duration,
        aiLabel: job.aiLabel,
      }),
    );

    const outFile = path.join(dir, "final.mp4");
    await runFfmpeg(
      buildComposeArgs({
        shots: buildShots(job, files),
        audioFile,
        talkingHeadFile,
        assFile,
        fontsDir: FONTS_DIR,
        duration,
        outFile,
      }),
    );

    const slug = job.script.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40) || "video";
    job.final = await storeVideo(await readFile(outFile), `${slug}-${job.id.slice(0, 8)}.mp4`);
    job.status = "done";
    log(job, "Done.");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export function assetsReady(job: RenderJob): boolean {
  return (
    !!job.voice.url &&
    job.visuals.every((v) => v.url) &&
    (job.mode === "faceless" || (!!job.actor.url && !!job.head.url))
  );
}

export async function advance(input: RenderJob): Promise<RenderJob> {
  const job: RenderJob = structuredClone(input);
  if (job.status !== "running") return job;
  try {
    await Promise.all([stepVoice(job), stepActor(job), ...job.visuals.map((v) => stepVisual(job, v))]);
    await stepHead(job);
    if (assetsReady(job)) await compose(job);
  } catch (err) {
    // Network blips and timeouts while polling shouldn't kill a job whose
    // tasks are still running at kie.ai; the next step retries them.
    if (err instanceof Error && (err.name === "TimeoutError" || (err instanceof TypeError && err.message === "fetch failed"))) {
      log(job, `Network error, will retry: ${err.message}`);
      return job;
    }
    job.status = "failed";
    job.error = err instanceof Error ? err.message : String(err);
    log(job, `Failed: ${job.error}`);
  }
  return job;
}
