import { config, requireEnv } from "./config";

// Minimal client for kie.ai's Market API: every model is a task created with
// POST /api/v1/jobs/createTask and polled with GET /api/v1/jobs/recordInfo.
// kie.ai returns errors as HTTP 200 with a non-200 `code`, so check both.

type Envelope<T> = { code: number; msg: string; data: T };

export type KieTask = {
  state: "waiting" | "queuing" | "generating" | "success" | "fail";
  urls: string[];
  result: Record<string, unknown> | null;
  error: string | null;
};

function headers(extra: Record<string, string> = {}) {
  return { authorization: `Bearer ${requireEnv("KIE_API_KEY")}`, ...extra };
}

async function unwrap<T>(res: Response, what: string): Promise<T> {
  const text = await res.text();
  let body: Envelope<T>;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`kie.ai ${what} returned non-JSON (${res.status}): ${text.slice(0, 200)}`);
  }
  if (!res.ok || body.code !== 200) {
    throw new Error(`kie.ai ${what} failed (${body.code ?? res.status}): ${body.msg}`);
  }
  return body.data;
}

export async function createTask(model: string, input: Record<string, unknown>): Promise<string> {
  const res = await fetch(`${config.kie.apiBase}/api/v1/jobs/createTask`, {
    method: "POST",
    headers: headers({ "content-type": "application/json" }),
    body: JSON.stringify({ model, input }),
    signal: AbortSignal.timeout(60_000),
  });
  const data = await unwrap<{ taskId: string }>(res, `createTask(${model})`);
  return data.taskId;
}

// Some models (e.g. Suno music) return {data: [{audio_url, ...}]} instead of
// resultUrls; collect their file URLs in order.
function mediaUrls(value: unknown): string[] {
  const urls: string[] = [];
  const visit = (v: unknown) => {
    if (Array.isArray(v)) return v.forEach(visit);
    if (!v || typeof v !== "object") return;
    for (const key of ["audio_url", "video_url"]) {
      const url = (v as Record<string, unknown>)[key];
      if (typeof url === "string" && url.startsWith("http")) urls.push(url);
    }
    Object.values(v).forEach((child) => typeof child === "object" && visit(child));
  };
  visit(value);
  return [...new Set(urls)];
}

export function parseTaskRecord(data: {
  state: KieTask["state"];
  resultJson?: string | null;
  failMsg?: string | null;
}): KieTask {
  let parsed: Record<string, unknown> | null = null;
  if (data.resultJson) {
    try {
      parsed = JSON.parse(data.resultJson);
    } catch {
      parsed = null;
    }
  }
  const urls = Array.isArray(parsed?.resultUrls) ? (parsed.resultUrls as string[]) : mediaUrls(parsed);
  const result = (parsed?.resultObject as Record<string, unknown> | undefined) ?? parsed;
  return {
    state: data.state,
    urls,
    result,
    error: data.state === "fail" ? data.failMsg || "Generation failed." : null,
  };
}

export async function getTask(taskId: string): Promise<KieTask> {
  const url = `${config.kie.apiBase}/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`;
  const res = await fetch(url, { headers: headers(), signal: AbortSignal.timeout(30_000) });
  return parseTaskRecord(await unwrap(res, "recordInfo"));
}

// Uploads a file so models can read it. kie.ai deletes uploads after 24 hours.
export async function uploadFile(data: Buffer, fileName: string, contentType: string): Promise<string> {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(data)], { type: contentType }), fileName);
  form.append("uploadPath", "ugc-studio");
  form.append("fileName", fileName);
  const res = await fetch(`${config.kie.uploadBase}/api/file-stream-upload`, {
    method: "POST",
    headers: headers(),
    body: form,
    signal: AbortSignal.timeout(120_000),
  });
  const result = await unwrap<{ downloadUrl: string }>(res, "file upload");
  return result.downloadUrl;
}

// Copies a remote file (e.g. a product image from the researched site) into
// kie.ai storage, for models that need a URL they can reliably fetch.
export async function uploadFromUrl(fileUrl: string, fileName: string): Promise<string> {
  const res = await fetch(`${config.kie.uploadBase}/api/file-url-upload`, {
    method: "POST",
    headers: headers({ "content-type": "application/json" }),
    body: JSON.stringify({ fileUrl, uploadPath: "ugc-studio", fileName }),
    signal: AbortSignal.timeout(120_000),
  });
  const result = await unwrap<{ downloadUrl: string }>(res, "URL upload");
  return result.downloadUrl;
}
