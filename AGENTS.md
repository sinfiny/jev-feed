# Jev Feed

Jev is a calm place to work through YouTube playlists: a library of playlists, each video opening into its chapters, and a player whose whole control deck (chapter-segmented scrubber, speed, skips, volume, fullscreen, one-key bookmarks) lives outside YouTube's frame. Its hero feature is the Feed Studio: an organizer designs a feed for a friend or a child — picks videos, orders them by hand or with a lens they write, pins and annotates them — and publishes a short `/feed/<id>` link that needs no account. A Cloudflare Worker (built with Vinext, a Next.js-compatible layer on Vite) fetches and parses YouTube, stores published feeds in Workers KV, and serves the app. Playlists, progress, lenses and drafts are stored in the browser.

Production runs at <https://jev.setavya.com>. Source lives at `github.com/sinfiny/jev-feed`.

## What makes Jev special?

Three things we do not compromise on.

### 1. Distraction-free

The whole product is a bet that a learner does better with less on screen. No autoplay sidebars, no engagement bait, no comments. Every added element has to justify its attention cost.

### 2. Fast and serverless

The app is one Worker with static assets. There are no servers, no cold-start-heavy runtimes, and no background jobs. Keep it that way. A ranking pass over hundreds of videos runs in a few milliseconds and must stay that fast; anything slow (Claude judging) is cached per video and never on the viewer's path.

### 3. Private by default

Progress, bookmarks, lenses, drafts and a copy of the playlists live in the viewer's browser. Sign-in is Google only, through Clerk, and exists to read the viewer's own playlists and likes; the Google token stays in the Worker and never reaches the browser. Public fetches for `/feed` are server-side so YouTube never sees the viewer. The only server storage is published feeds in KV: the snapshot an organizer chose to publish, with their Clerk user id as the owner. Nothing about viewers is stored. Analytics for published feeds is planned; build it to count views of a feed, not to profile people. No third-party trackers.

## How we like to work

Ambitious ideas, simple systems, software that feels obvious. Do not preserve complexity just because it already exists. Do not introduce machinery because it looks architecturally impressive. Understand the real constraint, then fight for the smallest model that makes the correct behavior unsurprising.

Channel both "measure twice, cut once" and "yagni". Fight scope creep. Honor the developer's intent in both a minimal and realistic fashion.

Right now Jev is a prototype whose job is to show reviewers what each feature is, how deep it goes, and what the app should look like. Ship the complete shape of a feature fast. A rebuild from first principles is planned once the shape is right, so do not gold-plate, and do not add infrastructure the shape does not need.

The rest of this document is meant to help you navigate the codebase and make changes effectively. Think of these instructions less as "hard rules", more as "good defaults". The developer's preferences override anything here.

Most contributions come from coding agents, often several running in parallel on the same machine, each in its own git worktree. Several dev servers, builds, and agents may be active at once. Be careful about killing processes, touching shared state, or deploying.

## A small glossary

- **you** means the agent reading this file and changing Jev.
- **developer** means the person directing agents on this repo.
- **viewer** means the person using a Jev feed to learn.
- **organizer** means the signed-in person who curates and publishes a feed for others.
- **playlist** means a YouTube playlist identified by its `list` id. In the sidebar these are the viewer's own playlists plus Liked videos (`LL`); `/feed` reads public ones.
- **library** means the viewer's playlists: local copies of Liked videos and their own YouTube playlists, up to twelve, with no cap on videos. A visit re-reads only playlists whose first page of ids changed, and fetches details only for videos it has not seen.
- **chapter** means a creator (or YouTube auto-generated) chapter with a start time. From the sidebar a chapter plays as its own clip, start to end.
- **bookmark** means a moment the viewer saved with the `B` key, with an optional note. Bookmarks list next to chapters as places to start.
- **snoozed** and **done** are per-video states. Snoozed videos sink below the rest of a playlist; done videos sink to the bottom.
- **lens** means a viewer-written schema for judging and ordering videos (`lib/lens.ts`): dials over metadata, lift and sink words, plain-language questions Claude answers once per video, and filters. Presets replace the old templates; `template=` in older `/feed` links maps onto a preset.
- **judgment** means Claude's cached 0–10 answer to one lens question for one video. Cached in the browser and carried inside published feeds, so viewers never trigger judging.
- **draft** means a feed being designed in the Studio, kept in the organizer's browser. Publishing snapshots it to KV.
- **feed** means the anonymous `/feed/<id>` page for a published feed. `/feed?playlist=` and `/feed?videos=` links from before publishing still work.
- **Worker** means the deployed Cloudflare Worker that serves the app.

## The three ways to hurt yourself

1. **Killing by pattern.** Never `pkill -f`, `pgrep | kill`, or `kill` a PID you found by matching a name, path, or worktree string. Your own agent process has this worktree's path in its argv, and this machine runs several other dev servers at once. Kill only a PID you captured at spawn.
2. **Deploying from a branch.** `npm run deploy` publishes whatever is built locally to production at `jev.setavya.com`. Only CI deploys, and only from `main`. Never run `wrangler deploy` from a worktree unless the developer explicitly asks.
3. **Committing credentials.** `.env*`, `.wrangler/`, `.openai/` runtime state, and anything with a token stays out of git. `.openai/hosting.json` is committed on purpose and contains no secret. Cloudflare credentials live only in GitHub Actions secrets.

## Hit every surface

The most common defect is a change that works on the path you tested and is missing everywhere else. Before calling work done, walk this list and say which entries applied:

- **Entry points.** The landing page and the Watch, Library and Studio views at `/` (desktop sidebar and phone tab bar are different layouts of the same views), the published feed at `/feed/<id>` and the older `/feed?…` links, the public APIs at `/api/playlist` and `/api/video`, the signed-in APIs under `/api/account/`, `/api/feeds` (publish, republish, take down) and `/api/judge` (Claude). A parsing change affects all of them.
- **Chapter sources.** Chapters come from description timestamps (RSS feed, player response) or from the `next` response's chapter markers. All of them go through `chaptersFrom` or `inOrder` in `lib/youtube-playlist.ts` and must carry start times.
- **Playlist sources.** Signed-in libraries come from the YouTube Data API (`lib/youtube-account.ts`). Public playlists for `/feed` come from scraping: YouTube's RSS feed covers 15 videos. Larger playlists come from parsing the playlist page, which has two renderer formats (`playlistVideoRenderer` and `lockupViewModel`). Both parsers live in `lib/youtube-playlist.ts` and both need to keep working. As of September 2026 YouTube serves only lockups. Single videos and enrichment go through `parseWatchPage`, which reads the embedded player response.
- **Library and progress state.** Playlists, lenses, judgments and drafts are stored in IndexedDB (`lib/store.ts`); per-video progress (status, position, bookmarks, done chapters, speed) in `localStorage` under `PROGRESS_KEY`. Parsers live next to each shape: `parseLibraryValue`/`parseProgress` in `lib/library.ts`, `parseLens`/`parseJudgments` in `lib/lens.ts`, `parseDrafts`/`parsePublishedFeed` in `lib/feed.ts`. Changing a shape needs a migration path in its parser so existing viewers do not lose anything. Video details carry `fetchedAt` and are read again after 29 days, in the library and in published feeds (`isStale` in `lib/learning.ts`), because YouTube's API policy allows copies to be kept for 30; when the viewer's YouTube access is gone, stale copies are removed instead. `readLibrary` moves the older `localStorage` copy (`LIBRARY_KEY`) into IndexedDB once, and `migrateLegacy` carries the username-era store forward once. Published feeds already in KV are read by `parsePublishedFeed`, so it must keep accepting old snapshots.
- **Lens and feed surfaces.** A lens change shows up in the Studio editor, the sidebar's per-playlist order, up next, and the published feed. Ranking must stay pure and fast; `tests/lens.test.ts` guards a 500-video pass.
- **Reverse states.** If you added a way in, add the way out. Done and snooze toggle back. A bookmark can be deleted. A removed playlist keeps its progress. A video left out of a feed can be put back; videos a lens sets aside are listed, not dropped. A published feed can be taken down; its draft stays.
- **Docs.** Check whether the change makes `README.md` or this file inaccurate.

## Dev servers

- `npm ci` installs. Node 22.13 or newer.
- `npm run dev` starts Vite with Vinext on port 5173. In a worktree, pass `-- --port <n>` if 5173 is taken. Read the real port from the Vite banner.
- `npm start` runs the built Worker locally through Wrangler with Miniflare state under `.wrangler/state`.
- Wrangler and Miniflare state is project-local and gitignored. Do not point at another checkout's `.wrangler`.
- Stop what you started, by the PID you tracked. See rule 1.

## Verifying

- Smallest proof that the change works. `npx vitest run tests/<file>` for the tests you touched, `npm run lint` and `npm run typecheck` for the scope you changed.
- Test meaningful logic or observable behavior: ranking order, parser output, state migration. Do not add tests that mirror the implementation or only assert wiring.
- Ranking and parsing changes ship with focused tests in `tests/`.
- `npm run build` is the real gate. Vinext and the Cloudflare plugin catch things `tsc` does not.
- CI owns the full suite. It runs lint, typecheck, tests, and build on every PR, uploads a preview version of the Worker with its own URL, and deploys `main` to production.
- Ask before using browsers or computer use for verification.

## Pull requests

- Never make a PR unless the developer explicitly asks you to do so.
- Conventional commit titles, plain language: `fix(ranking): kids template no longer buries short lectures`.
- Body: the problem in a sentence or two, then how you fixed it. End with the model and harness that did the work.
- UI changes need before/after images. Upload evidence to GitHub; never commit screenshots.
- One concern per PR. If the description says "also", split it.
- A PR is mergeable when CI is green and the preview URL behaves. When babysitting, poll checks and comments newer than the last push, fix real findings, dismiss false positives with a written reason, and stay quiet when nothing is new.

## Documentation

Most code changes do not need documentation. Agents can read the code.

- `README.md` is for the developer and users: what Jev does, how to run it, how it deploys. Update it when a capability or command changes.
- This file is for agents. Add a paragraph only if a maintainer would get something wrong without it. If reading the code answers the question, leave it out.
- Keep a local explanation in a nearby code comment. Comments describe how a thing is used, and move when the code moves.
- When a documented decision changes, rewrite the affected text. Do not append a second account of the new behavior.

## Plans and work artifacts

- Do not commit implementation plans, research notes, or agent scratch files. Keep temporary material outside the worktree. `/work/`, `/outputs/`, `/.agents/`, and `/.codex/` are gitignored as a safety net.
- Track active work in the GitHub issue or PR that owns it. A merged PR is the implementation record.

## How it works

The viewer signs in with Google (Clerk, `components/auth-provider.tsx`). `components/use-jev.ts` loads the library from IndexedDB at once, then refreshes it through `app/api/account/`, which checks the Clerk session with `@clerk/backend`, fetches the viewer's Google token from Clerk, and calls the YouTube Data API. For each playlist it reads one page of ids (`/api/account/playlist`); if the item count and first page match the stored `signature`, the playlist is skipped. Otherwise it pages through the ids and asks `/api/account/videos` (50 per call, with statistics and channel subscribers) only for ids not already complete. `lib/youtube-account.ts` parses the responses and `syncPlaylists` in `lib/library.ts` merges them. Clerk runs through `@clerk/react` with no middleware, because `@clerk/nextjs` and its matcher do not run on Vinext. Public playlists (Studio links and older `/feed?playlist=` links) come from `app/api/playlist/route.ts`, which reads the playlist page and follows innertube `browse` continuations past the first 100 videos; `browse` needs a current client version, read from the page. Single videos come from `app/api/video/route.ts` (innertube `player`, `next`, search, oEmbed). The player is YouTube's IFrame API with YouTube's controls off (`components/youtube-player.tsx`), driven by Jev's deck (`components/player-deck.tsx`), which polls the time four times a second while playing.

Lenses (`lib/lens.ts`) rank in the browser. Questions in a lens go to `app/api/judge/route.ts`, which asks Claude (`claude-opus-5-5`, low effort, JSON schema output) about twenty videos at a time; it needs the `ANTHROPIC_API_KEY` secret and a signed-in organizer, and all organizers share `JUDGE_CALLS_PER_DAY` calls a day, counted in `FEEDS` under `judge:<date>` because any Google account can sign in. Answers are cached per question and video, so each video is judged once. Publishing (`app/api/feeds/`) stores the snapshot from `toPublished` in the `FEEDS` KV namespace under an eight-character id, with the owner's Clerk user id in the key's metadata; only the owner can republish or take it down.

Deployment: `npm run build` runs Vinext and the Cloudflare Vite plugin, which emit the Worker to `dist/server` and static assets to `dist/client`, plus a generated `dist/server/wrangler.json`. Worker configuration such as bindings and the custom domain route is set in `vite.config.ts` and flows into that generated file. Never edit `dist/` by hand.

## Where code lives

- `app/` - Next.js App Router pages and API routes. `app/page.tsx` is the signed-in shell (Watch, Library, Studio), `app/feed/` the published feed.
- `lib/learning.ts` - video types, the regex-and-weights heuristics lenses read, formatting, and the legacy progress parser. Pure functions, no I/O.
- `lib/lens.ts` - lenses: dials, presets, ranking, reasons, and parsers. Pure.
- `lib/feed.ts` - feed drafts, ordering, the published snapshot and its validation. Pure.
- `lib/judge.ts` - the prompt, output schema and answer parser shared by `/api/judge` and the browser.
- `lib/store.ts` - the IndexedDB key-value store.
- `lib/youtube-playlist.ts` - URL validation, RSS, playlist page and watch page parsing. Pure functions over strings.
- `lib/library.ts` - playlists, per-video progress, bookmarks, queue order, sync merging, and the legacy migrations. Pure functions plus the storage read and write.
- `components/` - React components. `brand.tsx` holds the mascot, logo, status glyphs, confetti and in-context hints; `globals.css` holds the design tokens and the `.juicy`/`.sticker` styles they build on. `components/ui/` is vendored shadcn; leave it verbatim.
- `tests/` - Vitest unit tests. Config in `vitest.config.ts`, kept separate from `vite.config.ts` so tests never load the Cloudflare plugin.
- `db/`, `drizzle/` - Drizzle schema for future D1 persistence. Not bound in production yet.
- `build/sites-vite-plugin.ts` - vendored OpenAI Sites dev-auth plugin. Do not edit.
- `scripts/` - install and run wrappers that handle the managed-Linux execution profile. Rarely need changes.
- `.github/workflows/ci.yml` - lint, typecheck, test, build, preview version per PR, production deploy on `main`.

## Taste

- Complexity belongs at the parsing boundary. Ranking stays pure, UI stays dumb.
- Inferred types over annotations. `any` is the enemy.
- Heuristics in `lib/learning.ts` are regex-and-weights on purpose and stay as the dials that work with no key. Model judging is the opt-in layer on top: lens questions answered by Claude produce 0–10 readings that weigh exactly like a dial, with weights and positioning kept in our code.
- Viewers are trying to focus. No continuously repainting animations, no layout shift when data arrives, no spinners that lie. Motion is for answering the viewer — a press, a done, a publish — and the mascot only changes mood when something happened.
- Colors mean one thing each: lime is Jev, progress and done; pink is feeds and sharing; grape is lenses and judging; sun is in progress and bookmarks; sky is snoozed; tomato is taking something away.
- Teach in place. A new capability gets a one-time hint beside the control it describes (`useHints` in `components/brand.tsx`), dismissed when the viewer uses it, not a tour.
- If a rule here fights the task in front of you, say so loudly and get a human sign-off before breaking it.
