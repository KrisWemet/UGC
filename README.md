# UGC Studio

Paste a product URL and get UGC-style short video ads (9:16, 20–30 seconds) for TikTok, Reels and Shorts.

1. **Research**: scrapes the site (home page plus pricing/features pages), then Claude searches the web for reviews, complaints and competitors and writes a product brief.
2. **Scripts**: Claude writes several scripts, each on a different angle. You can edit every line before rendering.
3. **Render** through [kie.ai](https://kie.ai):
   - ElevenLabs voiceover (with word timestamps for captions)
   - Seedream images for b-roll and the AI creator's portrait (or real product images from the site)
   - a talking-head video of the creator: Infinitalk (budget) or Kling Avatar (premium)
4. **Compose** with ffmpeg: cuts between creator and b-roll with a slow zoom, burns in TikTok-style captions, an on-screen hook and an optional "AI-generated" label.

Two formats:

- **AI creator**: hook → problem (b-roll) → solution → demo (b-roll) → call to action
- **Faceless**: all visuals and voiceover. Cheaper and faster, with no synthetic person.

The pipeline is adapted from the SaaSShorts module of [OpenShorts](https://github.com/mutonby/openshorts) (MIT).

## Setup

```bash
npm install
cp .env.example .env.local   # add ANTHROPIC_API_KEY and KIE_API_KEY
npm run dev
```

Open http://localhost:3000.

| Variable | Required | Purpose |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | yes | Research and scripts (Claude) |
| `KIE_API_KEY` | yes | Voice, images, talking head |
| `BLOB_READ_WRITE_TOKEN` | no | Keep finished videos in Vercel Blob. Without it they're stored on kie.ai for 24 hours. |
| `BASIC_AUTH_USER` / `BASIC_AUTH_PASSWORD` | no, but set them when deployed | Password-protects the app so strangers can't spend your credits |

Model IDs live in `src/lib/config.ts` and can be overridden with env vars.

## Deploying to Vercel

It deploys as-is. The render route runs ffmpeg (bundled via `ffmpeg-static`) and needs up to 300 seconds for the final compose, so use a plan that allows a 300-second `maxDuration`.

## How rendering works

The browser holds each render job as JSON and calls `POST /api/render` every 5 seconds. Each call does one short step: start the kie.ai tasks that are ready, check the ones that are running, and compose the video once every asset exists. The server keeps no state, and a job resumes after a page reload.

## Advertising rules

The prompts present the speaker as a creator showing the product, not as a customer giving a testimonial. They allow only claims found on the site or in cited sources, and every caption ends with a `#ad`-style disclosure. Presenting AI actors as real customers can break FTC (US) and Competition Bureau (Canada) rules. Keep the "AI-generated" label on unless you have a reason not to.

## Development

```bash
npm test          # unit tests + a real ffmpeg render with synthetic inputs
npm run typecheck
npm run build
```
