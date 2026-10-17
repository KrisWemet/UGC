"use client";

import { useEffect, useRef, useState } from "react";
import type { RenderJob } from "@/lib/job";
import type { Research, Script, VideoMode } from "@/lib/types";
import { VOICES } from "@/lib/voices";

const JOBS_KEY = "ugc-studio-jobs";
const POLL_MS = 5000;

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({ error: `Request failed (${res.status}).` }));
  if (!res.ok) throw Object.assign(new Error(data.error ?? `Request failed (${res.status}).`), { blocked: !!data.blocked });
  return data as T;
}

function loadJobs(): RenderJob[] {
  try {
    return JSON.parse(localStorage.getItem(JOBS_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function saveJobs(jobs: RenderJob[]) {
  try {
    localStorage.setItem(JOBS_KEY, JSON.stringify(jobs.slice(0, 30)));
  } catch {
    // Storage full or blocked: jobs still work, they just won't survive a reload.
  }
}

export default function Studio() {
  const [url, setUrl] = useState("");
  const [pastedText, setPastedText] = useState("");
  const [needsPaste, setNeedsPaste] = useState(false);
  const [research, setResearch] = useState<Research | null>(null);
  const [scripts, setScripts] = useState<Script[]>([]);
  const [mode, setMode] = useState<VideoMode>("actor");
  const [quality, setQuality] = useState<"premium" | "budget">("budget");
  const [count, setCount] = useState(3);
  const [voiceId, setVoiceId] = useState<string>(VOICES[0].id);
  const [aiLabel, setAiLabel] = useState(true);
  const [motion, setMotion] = useState(true);
  const [music, setMusic] = useState(true);
  const [productInHand, setProductInHand] = useState(true);
  const [busy, setBusy] = useState<"research" | "scripts" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [jobs, setJobs] = useState<RenderJob[]>([]);
  const inFlight = useRef(new Set<string>());

  useEffect(() => setJobs(loadJobs()), []);
  useEffect(() => saveJobs(jobs), [jobs]);

  // Advance each running job one step at a time, never two requests per job.
  useEffect(() => {
    const timer = setInterval(() => {
      for (const job of jobs) {
        if (job.status !== "running" || inFlight.current.has(job.id)) continue;
        inFlight.current.add(job.id);
        post<{ job: RenderJob }>("/api/render", { action: "advance", job })
          .then(({ job: next }) => setJobs((all) => all.map((j) => (j.id === next.id ? next : j))))
          .catch((err) => console.error("advance failed, will retry:", err))
          .finally(() => inFlight.current.delete(job.id));
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [jobs]);

  async function runResearch(e: React.FormEvent) {
    e.preventDefault();
    setBusy("research");
    setError(null);
    setResearch(null);
    setScripts([]);
    try {
      const { research } = await post<{ research: Research }>("/api/research", {
        url,
        pastedText: needsPaste ? pastedText : undefined,
      });
      setResearch(research);
    } catch (err) {
      setError((err as Error).message);
      if ((err as { blocked?: boolean }).blocked) setNeedsPaste(true);
    } finally {
      setBusy(null);
    }
  }

  async function writeScripts() {
    if (!research) return;
    setBusy("scripts");
    setError(null);
    try {
      const { scripts } = await post<{ scripts: Script[] }>("/api/scripts", { research, mode, count });
      setScripts(scripts);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  function editNarration(scriptIndex: number, segmentIndex: number, narration: string) {
    setScripts((all) =>
      all.map((s, i) =>
        i !== scriptIndex
          ? s
          : { ...s, segments: s.segments.map((seg, j) => (j === segmentIndex ? { ...seg, narration } : seg)) },
      ),
    );
  }

  async function renderVariant(job: RenderJob, variant: number) {
    setError(null);
    try {
      const { job: next } = await post<{ job: RenderJob }>("/api/render", { action: "variant", job, variant });
      setJobs((all) => [next, ...all]);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function render(script: Script) {
    if (!research) return;
    setError(null);
    try {
      const { job } = await post<{ job: RenderJob }>("/api/render", {
        action: "create",
        mode,
        quality,
        voiceId,
        aiLabel,
        motion,
        music,
        productInHand,
        script,
        siteImages: research.images,
      });
      setJobs((all) => [job, ...all]);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <main>
      <h1>UGC Studio</h1>
      <p className="muted">Paste a product URL. Get researched, creator-style short video ads.</p>

      <form className="panel row" onSubmit={runResearch}>
        <input
          type="url"
          required
          placeholder="https://your-product.com"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <button disabled={busy !== null || (needsPaste && !pastedText.trim())}>
          {busy === "research" ? "Researching… (about a minute)" : "Research"}
        </button>
        {needsPaste && (
          <textarea
            style={{ minHeight: 140 }}
            placeholder="Paste the product page text or a description: what it is, who it's for, key features, prices, offers."
            value={pastedText}
            onChange={(e) => setPastedText(e.target.value)}
          />
        )}
      </form>

      {error && <p className="panel error">{error}</p>}

      {research && (
        <section className="panel">
          <h2>{research.brief.productName}</h2>
          <p>{research.brief.oneLiner}</p>
          <div className="grid">
            <div>
              <h3>Pain points</h3>
              <ul className="tight">
                {research.brief.painPoints.map((p) => (
                  <li key={p.pain}>
                    {p.pain} <span className="tag">{p.source}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3>Angles</h3>
              <ul className="tight">
                {research.brief.angles.map((a) => (
                  <li key={a.angle}>{a.angle}</li>
                ))}
              </ul>
              <h3 style={{ marginTop: 12 }}>Claims we can back up</h3>
              <ul className="tight">
                {research.brief.verifiableClaims.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </div>
          </div>
          {research.images.length > 0 && (
            <>
              <h3 style={{ marginTop: 16 }}>Images from the site</h3>
              <div className="thumbs">
                {research.images.map((img) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={img.url} src={img.url} alt={img.alt} />
                ))}
              </div>
            </>
          )}
          {research.sources.length > 0 && (
            <details style={{ marginTop: 12 }}>
              <summary className="small muted">{research.sources.length} web sources</summary>
              <ul className="tight small">
                {research.sources.map((s) => (
                  <li key={s.url}>
                    <a href={s.url} target="_blank" rel="noreferrer">
                      {s.title || s.url}
                    </a>
                  </li>
                ))}
              </ul>
            </details>
          )}

          <div className="row" style={{ marginTop: 20 }}>
            <select value={mode} onChange={(e) => setMode(e.target.value as VideoMode)}>
              <option value="actor">AI creator talking to camera</option>
              <option value="faceless">Faceless: visuals + voiceover</option>
            </select>
            <select value={count} onChange={(e) => setCount(Number(e.target.value))}>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n} script{n > 1 ? "s" : ""}
                </option>
              ))}
            </select>
            <button onClick={writeScripts} disabled={busy !== null}>
              {busy === "scripts" ? "Writing…" : "Write scripts"}
            </button>
          </div>
        </section>
      )}

      {scripts.length > 0 && (
        <section className="panel">
          <h2>Scripts</h2>
          <div className="row" style={{ marginBottom: 12 }}>
            <select value={voiceId} onChange={(e) => setVoiceId(e.target.value)}>
              {VOICES.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}: {v.note}
                </option>
              ))}
            </select>
            {mode === "actor" && (
              <select value={quality} onChange={(e) => setQuality(e.target.value as "premium" | "budget")}>
                <option value="budget">Budget talking head (Infinitalk)</option>
                <option value="premium">Premium talking head (Kling Avatar)</option>
              </select>
            )}
            <label className="inline small">
              <input type="checkbox" checked={aiLabel} onChange={(e) => setAiLabel(e.target.checked)} />
              Show &quot;AI-generated&quot; label
            </label>
            <label className="inline small">
              <input type="checkbox" checked={motion} onChange={(e) => setMotion(e.target.checked)} />
              Animated b-roll
            </label>
            <label className="inline small">
              <input type="checkbox" checked={music} onChange={(e) => setMusic(e.target.checked)} />
              Background music
            </label>
            {mode === "actor" && (
              <label className="inline small">
                <input type="checkbox" checked={productInHand} onChange={(e) => setProductInHand(e.target.checked)} />
                Creator holds the product
              </label>
            )}
          </div>
          <div className="grid">
            {scripts.map((script, si) => (
              <article key={si} className="panel" style={{ marginTop: 0 }}>
                <h3>{script.title}</h3>
                <p className="small muted">{script.angle}</p>
                <p className="small">
                  <span className="tag">Hook text</span>
                  {script.hookText}
                </p>
                {script.segments.map((seg, gi) => (
                  <div key={gi} className="segment">
                    <span className="tag">{seg.kind}</span>
                    <span className="tag">
                      {seg.shot === "actor" ? "creator on camera" : seg.siteImageIndex !== null ? "site image" : "generated image"}
                    </span>
                    {seg.onScreenText && <span className="tag">pop-up: {seg.onScreenText}</span>}
                    <textarea value={seg.narration} onChange={(e) => editNarration(si, gi, e.target.value)} />
                  </div>
                ))}
                <p className="small muted" style={{ marginTop: 10 }}>
                  {script.caption} {script.hashtags.join(" ")}
                </p>
                <button onClick={() => render(script)}>Render video</button>
              </article>
            ))}
          </div>
        </section>
      )}

      {jobs.length > 0 && (
        <section className="panel">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h2>Videos</h2>
            <button className="secondary" onClick={() => setJobs((all) => all.filter((j) => j.status === "running"))}>
              Clear finished
            </button>
          </div>
          <div className="grid">
            {jobs.map((job) => (
              <article key={job.id} className="panel" style={{ marginTop: 0 }}>
                <h3>{job.script.title}</h3>
                <p className={`small ${job.status === "failed" ? "error" : job.status === "done" ? "done" : "muted"}`}>
                  {job.status === "running" ? "Rendering…" : job.status === "done" ? "Ready" : `Failed: ${job.error}`}
                </p>
                {job.final && (
                  <>
                    <video src={job.final.url} controls playsInline />
                    <p className="small" style={{ marginTop: 8 }}>
                      <a href={job.final.url} download>
                        Download MP4
                      </a>
                      {job.final.expires && <span className="muted"> · link expires in 24 hours</span>}
                    </p>
                  </>
                )}
                {job.status === "done" && job.script.hookVariants.length > 0 && (
                  <div className="row small" style={{ margin: "8px 0" }}>
                    <span className="muted">A/B test the hook:</span>
                    {job.script.hookVariants.map((v, vi) => (
                      <button key={vi} className="secondary" onClick={() => renderVariant(job, vi)} title={v.line}>
                        {v.hookText}
                      </button>
                    ))}
                  </div>
                )}
                <div className="log">{job.log.join("\n")}</div>
              </article>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
