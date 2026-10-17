# UGC Studio

Paste a product URL and get UGC-style short video ads (9:16, 20–30 seconds) for TikTok, Reels and Shorts.

1. **Research**: scrapes the site (home page plus pricing/features pages), then Claude writes a product brief. With an Anthropic key, Claude also searches the web for reviews, complaints and competitors.
2. **Scripts**: Claude writes several scripts, each on a different angle. You can edit every line before rendering.
3. **Render** through [kie.ai](https://kie.ai):
   - a voiceover from Google Gemini TTS (default, with a casual-creator speaking style) or ElevenLabs. If ElevenLabs fails, the app switches to a Google voice.
   - Seedream images for b-roll and the AI creator's portrait (or real product images from the site)
   - a talking-head video of the creator: Infinitalk (budget) or Kling Avatar (premium)
4. **Edit** with ffmpeg in a fast UGC style:
   - jump cuts: the creator's footage is cut into ~2-second shots that alternate with a punch-in zoom
   - b-roll stills animated into short clips (Hailuo image-to-video), falling back to a slow zoom if a clip fails
   - pop-up text stickers on key beats ("43G PROTEIN"), TikTok-style captions with numbers in yellow, an on-screen hook and an optional "AI-generated" label
   - an instrumental music bed (Suno) mixed under the voice
   - transitions (slide, zoom, circle) where the video moves between the creator and b-roll; cuts within the creator's footage stay hard
   - karaoke captions: the word being spoken turns yellow
   - the creator holding the product: their portrait is edited (Nano Banana) to hold a real site image or the generated product shot before the talking head is made
5. **A/B test hooks**: each script comes with 2 alternative opening lines. On a finished video, one click renders a variant that changes only the hook, reusing the creator, b-roll and music.

Rough cost per 25-second AI-creator video on kie.ai: about 310 credits. The talking head (Kling Avatar) is about 190 of that, the three animated b-roll clips 90, music 12, images about 13, voice and scripts under 2. A hook variant costs about 195 (new voice and talking head only).

   Animated b-roll and music can be turned off per video to save credits and time.

Two formats:

- **AI creator**: hook → problem (b-roll) → solution → two demo shots (b-roll) → key fact → call to action
- **Faceless**: all visuals and voiceover. Cheaper and faster, with no synthetic person.

The pipeline is adapted from the SaaSShorts module of [OpenShorts](https://github.com/mutonby/openshorts) (MIT).

## Setup

```bash
npm install
cp .env.example .env.local   # add KIE_API_KEY (the only required key)
npm run dev
```

Open http://localhost:3000.

kie.ai's Claude endpoint doesn't support structured outputs or web search, so on kie.ai the app asks for JSON in the prompt, validates it, and researches from the site content only. kie.ai models also have occasional outages: failed tasks are retried, and a failed talking head is retried on the other avatar model.

Some large brand sites block automated visitors. When that happens the app asks you to paste the product details instead, and research continues from that text.

| Variable | Required | Purpose |
| --- | --- | --- |
| `KIE_API_KEY` | yes | Voice, images and talking head. Also runs Claude for research and scripts on kie.ai credits when no Anthropic key is set. |
| `ANTHROPIC_API_KEY` | no | Claude on Anthropic's own API. Adds web search for reviews and competitors. |
| `OPENROUTER_API_KEY` | no | Backup: free OpenRouter models, used if the other providers fail. Override the model list with `OPENROUTER_MODELS`. |
| `LLM_PROVIDER` | no | Force `anthropic`, `kie` or `openrouter` first. By default the first provider with a key is used, in that order. |
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
