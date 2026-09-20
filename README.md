# Jev Feed

Jev lets you curate your own custom video feed from YouTube. Jev's ranking decides which video comes first, you share the feed with friends or children, and progress is saved locally per playlist. Analytics on who watches a feed is the next planned capability.

## Current capabilities

- Import a public YouTube playlist from its URL.
- Analyze 10, 50, or 100 videos when the playlist contains them.
- Validate playlist URLs and fetch the public YouTube feed server-side.
- Read duration, view count, YouTube category, publish date, keywords and chapter titles from public YouTube pages, with no API key.
- Sign in with just a username (no password, browser-only) and own up to five playlists.
- Build a playlist one video at a time from any YouTube video link, remove videos, or save an editable copy of an imported playlist.
- Rank videos through learning-edge, balanced-foundation, or child-focused perspectives.
- Show research depth, clarity, learnability, focus quality, and recommendation reasons.
- Play videos in a focused embedded player.
- Adjust future recommendations from “too hard,” “just right,” and “too easy” feedback.
- Preserve progress for each playlist in the viewer's browser.
- Publish a separate anonymous feed URL under `/feed` with its playlist, template, and size encoded in the link. Feeds built from individual videos encode their video ids instead, so no server state is needed.

Accounts and owned playlists live in the browser's `localStorage`. This is the shape of the feature for review; a server-backed account needs D1, which is not bound yet.

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
npm run check   # lint, typecheck, unit tests
npm run build
```

Unit tests live in `tests/` and run with Vitest. CI runs the same checks on every pull request.

## Project structure

- `app/page.tsx` — the interactive learning feed.
- `app/api/playlist/route.ts` — public YouTube playlist ingestion.
- `app/api/video/route.ts` — single-video metadata from public watch pages (up to 10 per request).
- `lib/account.ts` — username accounts and owned playlists, browser-only.
- `lib/learning.ts` — ranking and device-local progress logic.
- `lib/youtube-playlist.ts` — playlist URL validation and feed parsing.

## Deployment

The application builds as a Cloudflare Worker through Vinext. `.openai/hosting.json` preserves the existing ChatGPT Sites project association; it contains no deployment credential or secret.

Production runs at [jev.setavya.com](https://jev.setavya.com), with [jev-feed.viod606.workers.dev](https://jev-feed.viod606.workers.dev) as a fallback hostname. Worker configuration, including the custom domain, lives in `vite.config.ts` and flows into the generated `dist/server/wrangler.json`.

GitHub Actions in `.github/workflows/ci.yml` handles delivery:

- Every pull request runs lint, typecheck, tests, and build, then uploads a preview version of the Worker and comments its URL on the PR. Production traffic is unaffected.
- Every push to `main` deploys to production.

CI needs two repository secrets: `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`. The token needs Workers Scripts Edit, Workers Routes Edit, Account Settings Read and Zone Read for `setavya.com`.

A manual deploy from an authenticated Wrangler session is still possible with `npm run deploy`, but should be reserved for emergencies.

Agent guidance for working in this repo is in `AGENTS.md`.
