# Jev Feed

Jev turns a public YouTube playlist into an adaptive, distraction-free learning feed. Videos are ranked around the viewer's current learning edge, and progress is saved locally per playlist.

## Current capabilities

- Import a public YouTube playlist from its URL.
- Analyze 10, 50, or 100 videos when the playlist contains them.
- Validate playlist URLs and fetch the public YouTube feed server-side.
- Rank videos through learning-edge, balanced-foundation, or child-focused perspectives.
- Show research depth, clarity, learnability, focus quality, and recommendation reasons.
- Play videos in a focused embedded player.
- Adjust future recommendations from “too hard,” “just right,” and “too easy” feedback.
- Preserve progress for each playlist in the viewer's browser.
- Publish a separate anonymous feed URL under `/feed` with its playlist, template, and size encoded in the link.

The next planned product slice is public feed publishing: an organizer chooses a playlist and ranking template, publishes it to a Cloudflare-managed subdomain, and shares an anonymous, instantly accessible feed with an audience.

## Development

Requires Node.js 22.13 or newer.

```bash
npm ci
npm run dev
```

The development server runs at `http://localhost:5173` by default.

## Quality checks

```bash
npm run lint
npm run build
```

## Project structure

- `app/page.tsx` — the interactive learning feed.
- `app/api/playlist/route.ts` — public YouTube playlist ingestion.
- `lib/learning.ts` — ranking and device-local progress logic.
- `lib/youtube-playlist.ts` — playlist URL validation and feed parsing.

## Deployment

The application builds as a Cloudflare-compatible Worker through Vinext. `.openai/hosting.json` preserves the existing ChatGPT Sites project association; it contains no deployment credential or secret.

The current Cloudflare deployment is available at [jev-feed.viod606.workers.dev](https://jev-feed.viod606.workers.dev). After authenticating Wrangler, build and deploy the current branch with:

```bash
npm run deploy
```

Wildcard per-feed custom subdomains are not implemented yet; the MVP uses shareable `/feed` links on the deployed Worker.
