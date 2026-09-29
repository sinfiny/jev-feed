# Jev Feed

Jev is a calm place to work through YouTube playlists. Your playlists sit in a sidebar, each video opens into its chapters so a long video has more than one way in, and a control bar under the player handles speed, skipping, and one-key bookmarks. Everything you do is saved in your browser.

## Current capabilities

- Paste a public YouTube playlist link to copy up to 100 of its videos into the sidebar. Pasting it again refreshes the copy. Pasting a single video link adds it to the open playlist, or to "Saved videos".
- See each video's chapters, with start times, without opening it. Chapters come from the description's timestamps or YouTube's own chapter markers (including auto-generated ones) and are read server-side with no API key.
- Play a single chapter from start to end, or keep watching past it.
- Play videos in YouTube's embedded player with Jev's control bar: 1× to 2× speed, 10-second skips, and bookmarks. Keys: `B` bookmark, `J`/`L` skip, `K` play or pause, `<`/`>` speed.
- Bookmark a moment with one key and add a note to it afterwards. Bookmarks sit next to the chapters and are places to start from.
- Resume a video where you stopped. The last video you had open comes back, paused, on your next visit.
- Snooze a video (it sinks below the rest) or mark it done (it sinks to the bottom). Both toggle back. Finishing a video or a chapter marks it done.
- Share a playlist as an anonymous `/feed` link that encodes its video ids, so no server state is needed. Older `/feed` links with a ranking template still rank.

Playlists and progress live in the browser's `localStorage`. Google sign-in, to load private playlists and liked videos without pasting links, is the next planned slice.

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

- `app/page.tsx` — the sidebar, player, and control bar.
- `app/api/playlist/route.ts` — public YouTube playlist ingestion.
- `app/api/video/route.ts` — single-video metadata from public watch pages (up to 10 per request).
- `lib/library.ts` — playlists, per-video progress, bookmarks, and the migration from the username-era store.
- `lib/learning.ts` — video types and the template ranking still used by older `/feed` links.
- `lib/youtube-playlist.ts` — playlist URL validation, feed parsing, and chapter parsing.

## Deployment

The application builds as a Cloudflare Worker through Vinext. `.openai/hosting.json` preserves the existing ChatGPT Sites project association; it contains no deployment credential or secret.

Production runs at [jev.setavya.com](https://jev.setavya.com), with [jev-feed.viod606.workers.dev](https://jev-feed.viod606.workers.dev) as a fallback hostname. Worker configuration, including the custom domain, lives in `vite.config.ts` and flows into the generated `dist/server/wrangler.json`.

GitHub Actions in `.github/workflows/ci.yml` handles delivery:

- Every pull request runs lint, typecheck, tests, and build, then uploads a preview version of the Worker and comments its URL on the PR. Production traffic is unaffected.
- Every push to `main` deploys to production.

CI needs two repository secrets: `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`. The token needs Workers Scripts Edit, Workers Routes Edit, Account Settings Read and Zone Read for `setavya.com`.

A manual deploy from an authenticated Wrangler session is still possible with `npm run deploy`, but should be reserved for emergencies.

Agent guidance for working in this repo is in `AGENTS.md`.
