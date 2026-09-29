# Jev Feed

Jev is a calm place to work through YouTube — and to hand someone else a better way through it. Sign in with Google and your playlists and liked videos form a library; each video opens into its chapters, and a control deck outside YouTube's frame handles everything from speed to bookmarks. In the Feed Studio you design a feed for a friend or a child and send it as a short link.

## Current capabilities

- **Library.** Liked videos and your own playlists, private ones included (up to 12 playlists, no limit on videos). A visit only re-reads playlists that changed and only fetches details for new videos. On a desktop it is a sidebar tree of playlist › video › chapters; on a phone, playlist cards that open into their videos.
- **Metadata.** Views, likes, like ratio, channel subscribers, length and age for every video.
- **Player deck.** YouTube's own controls are hidden; Jev's deck has a scrubber split into the video's chapters with a pin for each bookmark, play/pause, next, ±10 s, 1×–2× speed, volume, and fullscreen (window-filling on phones that can't go fullscreen). Keys: `B` bookmark, `J`/`L` skip, `K` or space play/pause, `N` next, `<`/`>` speed.
- **Chapters and bookmarks.** Chapters come from description timestamps or YouTube's chapter markers (including auto-generated ones). Play a chapter as its own clip or keep watching. Bookmarks take a note and sit beside chapters as places to start.
- **Progress.** Resume where you stopped; snooze (sinks below the rest) or mark done (sinks to the bottom); both toggle back. Finishing a video or chapter marks it done.
- **Lenses.** Write your own schema for how videos are judged and ordered: eleven dials over what Jev reads from each video (depth, calm, hands-on, beginner-friendly, big ideas, quick, fresh, popular, loved, small creators, chapters), words that lift or sink a video, filters, and up to five questions in your own words that Claude answers once per video. Every video shows why it landed where it did. Six presets to start from. Use a lens on your own playlists from the sidebar, or on a feed.
- **Feed Studio.** Start a feed from a library playlist, any public playlist (no 100-video limit) or video links, or from any video you're watching. Order by hand (drag, or arrows on a phone) or by a lens; pin must-watch videos; leave notes; leave videos out and put them back. Publish a short `/feed/<id>` link, update it in place, or take it down.
- **Published feeds.** Anyone with the link can watch, no account needed, with the same player deck; their progress stays on their device. Older `/feed?playlist=` and `/feed?videos=` links still work, and their `template=` maps onto a lens preset.
- **Like** a video from the deck; the like lands on YouTube.

The library, lenses, Claude's cached answers and feed drafts live in the browser's IndexedDB; progress and bookmarks in `localStorage`. Published feeds are the only thing stored on the server, in Workers KV. Sign-in runs through Clerk with Google as the only method. The Worker reads your Google token from Clerk to call the YouTube Data API and never sends it to the browser.

## Development

Requires Node.js 22.13 or newer.

```bash
npm ci
npm run dev
```

The development server runs at `http://localhost:5173` by default. Sign-in needs Clerk keys in `.env.local`: run `clerk env pull` after `clerk auth login` and `clerk link`. The Clerk instance's Google connection uses Jev's own Google OAuth client with the `https://www.googleapis.com/auth/youtube` scope, from a Google Cloud project with the YouTube Data API enabled.

Lens questions need `ANTHROPIC_API_KEY` in `.env.local` (and as a Worker secret in production). Without it everything else works and questions say Claude is not switched on. To cap spending, all organizers share 40 Claude calls a day (about 800 videos), set by `JUDGE_CALLS_PER_DAY` in `lib/judge.ts`. Publishing uses the `FEEDS` KV binding, which Miniflare provides locally.

## Quality checks

```bash
npm run check   # lint, typecheck, unit tests
npm run build
```

Unit tests live in `tests/` and run with Vitest. CI runs the same checks on every pull request.

## Project structure

- `app/page.tsx` — the signed-in shell: Watch, Library and Studio.
- `app/feed/` — published feeds (`/feed/<id>`) and older `/feed?…` links.
- `app/api/playlist/route.ts` — public YouTube playlists, the whole playlist.
- `app/api/video/route.ts` — single-video metadata (up to 10 per request).
- `app/api/account/` — the signed-in viewer's playlists (paged ids), video details with statistics, and likes, through the YouTube Data API.
- `app/api/feeds/` — publish, republish, read and take down feeds in KV.
- `app/api/judge/route.ts` — Claude's answers to lens questions.
- `components/` — the design system (`brand.tsx`), player deck, library, watch view, Studio and lens editor.
- `lib/lens.ts`, `lib/feed.ts`, `lib/library.ts`, `lib/learning.ts` — ranking, feeds, library state and heuristics, all pure.
- `lib/youtube-account.ts`, `lib/youtube-playlist.ts` — YouTube response parsing.

## Deployment

The application builds as a Cloudflare Worker through Vinext. `.openai/hosting.json` preserves the existing ChatGPT Sites project association; it contains no deployment credential or secret.

Production runs at [jev.setavya.com](https://jev.setavya.com), with [jev-feed.viod606.workers.dev](https://jev-feed.viod606.workers.dev) as a fallback hostname. Worker configuration, including the custom domain, lives in `vite.config.ts` and flows into the generated `dist/server/wrangler.json`.

GitHub Actions in `.github/workflows/ci.yml` handles delivery:

- Every pull request runs lint, typecheck, tests, and build, then uploads a preview version of the Worker and comments its URL on the PR. Production traffic is unaffected.
- Every push to `main` deploys to production.

CI needs two repository secrets, `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`, and a repository variable, `CLERK_PUBLISHABLE_KEY`, which the build inlines. The Worker needs `CLERK_SECRET_KEY` as a secret, and `ANTHROPIC_API_KEY` for lens questions (`cf workers secrets update <NAME> --worker jev-feed`). The `FEEDS` KV namespace already exists (`jev-feed-FEEDS`, made with `cf kv namespaces create`) and its id is set in `vite.config.ts`, so the token needs no KV permission. These are the keys of Clerk's production instance, which only serves `jev.setavya.com`, so sign-in does not work on PR preview URLs; test sign-in locally against the development instance. The token needs Workers Scripts Edit, Workers Routes Edit, Account Settings Read and Zone Read for `setavya.com`.

A manual deploy from an authenticated Wrangler session is still possible with `npm run deploy`, but should be reserved for emergencies.

Agent guidance for working in this repo is in `AGENTS.md`.
