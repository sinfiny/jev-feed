# Jev Feed

Jev is a calm place to work through YouTube playlists. Sign in with Google and your playlists and liked videos sit in a sidebar, each video opens into its chapters so a long video has more than one way in, and a control bar under the player handles speed, skipping, and one-key bookmarks. Everything you do is saved in your browser.

## Current capabilities

- Sign in with Google, the only way in. Liked videos and your own playlists, private ones included, load into the sidebar (up to 12 playlists, 100 videos each) and refresh on every visit.
- Like a video, or take the like back, from the control bar. The like lands on YouTube.
- See each video's chapters, with start times, without opening it. Chapters come from the description's timestamps or YouTube's own chapter markers (including auto-generated ones) and are read server-side with no API key.
- Play a single chapter from start to end, or keep watching past it.
- Play videos in YouTube's embedded player with Jev's control bar: 1× to 2× speed, 10-second skips, and bookmarks. Keys: `B` bookmark, `J`/`L` skip, `K` play or pause, `<`/`>` speed.
- Bookmark a moment with one key and add a note to it afterwards. Bookmarks sit next to the chapters and are places to start from.
- Resume a video where you stopped. The last video you had open comes back, paused, on your next visit.
- Snooze a video (it sinks below the rest) or mark it done (it sinks to the bottom). Both toggle back. Finishing a video or a chapter marks it done.
- Share a playlist as an anonymous `/feed` link that encodes its video ids, so no server state is needed. Older `/feed` links with a ranking template still rank.

Progress and bookmarks live in the browser's `localStorage`, as does a copy of your playlists. Sign-in runs through Clerk with Google as the only method. The Worker reads your Google token from Clerk to call the YouTube Data API and never sends it to the browser.

## Development

Requires Node.js 22.13 or newer.

```bash
npm ci
npm run dev
```

The development server runs at `http://localhost:5173` by default. Sign-in needs Clerk keys in `.env.local`: run `clerk env pull` after `clerk auth login` and `clerk link`. The Clerk instance's Google connection uses Jev's own Google OAuth client with the `https://www.googleapis.com/auth/youtube` scope, from a Google Cloud project with the YouTube Data API enabled.

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
- `app/api/account/` — the signed-in viewer's playlists, the videos in each, and likes, through the YouTube Data API.
- `lib/youtube-account.ts` — YouTube Data API response parsing.
- `lib/library.ts` — playlists, per-video progress, bookmarks, and the migration from the username-era store.
- `lib/learning.ts` — video types and the template ranking still used by older `/feed` links.
- `lib/youtube-playlist.ts` — playlist URL validation, feed parsing, and chapter parsing.

## Deployment

The application builds as a Cloudflare Worker through Vinext. `.openai/hosting.json` preserves the existing ChatGPT Sites project association; it contains no deployment credential or secret.

Production runs at [jev.setavya.com](https://jev.setavya.com), with [jev-feed.viod606.workers.dev](https://jev-feed.viod606.workers.dev) as a fallback hostname. Worker configuration, including the custom domain, lives in `vite.config.ts` and flows into the generated `dist/server/wrangler.json`.

GitHub Actions in `.github/workflows/ci.yml` handles delivery:

- Every pull request runs lint, typecheck, tests, and build, then uploads a preview version of the Worker and comments its URL on the PR. Production traffic is unaffected.
- Every push to `main` deploys to production.

CI needs two repository secrets, `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`, and a repository variable, `CLERK_PUBLISHABLE_KEY`, which the build inlines. The Worker needs `CLERK_SECRET_KEY` as a secret. The token needs Workers Scripts Edit, Workers Routes Edit, Account Settings Read and Zone Read for `setavya.com`.

A manual deploy from an authenticated Wrangler session is still possible with `npm run deploy`, but should be reserved for emergencies.

Agent guidance for working in this repo is in `AGENTS.md`.
