# Jev Feed

Jev lets a person curate a custom video feed from YouTube, imported from a playlist or built one video at a time, and share it with friends or children. Jev's ranking decides which video comes first. A Cloudflare Worker (built with Vinext, a Next.js-compatible layer on Vite) fetches YouTube pages, ranks videos through one of three perspectives, and serves an interactive builder plus anonymous shareable `/feed` links. Progress and owned playlists are stored in the browser.

Production runs at <https://jev.setavya.com>. Source lives at `github.com/sinfiny/jev-feed`.

This document follows the shape of the T3 Code `AGENTS.md`. Sections that describe T3 Code's own product were replaced with Jev's. The philosophy sections were kept because they are the point.

## What makes Jev special?

Three things we do not compromise on.

### 1. Distraction-free

The whole product is a bet that a learner does better with less on screen. No autoplay sidebars, no engagement bait, no comments. Every added element has to justify its attention cost.

### 2. Fast and serverless

The app is one Worker with static assets. There are no servers, no cold-start-heavy runtimes, and no background jobs. Keep it that way. A ranking pass over 100 videos runs in a few milliseconds and must stay that fast.

### 3. Private by default

Learning progress never leaves the browser. Playlist fetches are server-side so YouTube never sees the viewer. Do not add tracking, accounts, or persistence without an explicit request from the developer.

## A note from Theo

Copied from the T3 Code repository because it applies here too.

> I like ambitious ideas, simple systems, and software that feels obvious. Do not preserve complexity just because it already exists. Do not introduce machinery because it looks architecturally impressive. Understand the real constraint, then fight for the smallest model that makes the correct behavior unsurprising.
>
> Channel both "measure twice, cut once" and "yagni". Fight scope creep. Try to honor the dev's intent in both a minimal and realistic fashion.

The rest of this document is meant to help you navigate the codebase and make changes effectively. Think of these instructions less as "hard rules", more as "good defaults". The developer's preferences override anything here.

Most contributions come from coding agents run in parallel through T3 Code, each in its own git worktree. Several dev servers, builds, and agents may be running on the same machine at once. Be careful about killing processes, touching shared state, or deploying.

## A small glossary

- **you** means the agent reading this file and changing Jev.
- **developer** means the person directing agents on this repo.
- **viewer** means the person using a Jev feed to learn.
- **organizer** means the person who publishes a feed for others.
- **playlist** means a public YouTube playlist identified by its `list` id.
- **template** means a ranking perspective: `stretch` (deepest first), `balanced` (practical first), or `kids` (low-distraction first).
- **mastery** means the viewer's current learning edge, a number from 30 to 92 adjusted by "too hard / just right / too easy" feedback.
- **feed** means the ranked list of videos for one playlist, template, and size.
- **Worker** means the deployed Cloudflare Worker that serves the app.

## The three ways to hurt yourself

1. **Killing by pattern.** Never `pkill -f`, `pgrep | kill`, or `kill` a PID you found by matching a name, path, or worktree string. Your own agent process has this worktree's path in its argv, and this machine runs several other dev servers at once. Kill only a PID you captured at spawn.
2. **Deploying from a branch.** `npm run deploy` publishes whatever is built locally to production at `jev.setavya.com`. Only CI deploys, and only from `main`. Never run `wrangler deploy` from a worktree unless the developer explicitly asks.
3. **Committing credentials.** `.env*`, `.wrangler/`, `.openai/` runtime state, and anything with a token stays out of git. `.openai/hosting.json` is committed on purpose and contains no secret. Cloudflare credentials live only in GitHub Actions secrets.

## Hit every surface

The most common defect is a change that works on the path you tested and is missing everywhere else. Before calling work done, walk this list and say which entries applied:

- **Entry points.** The interactive feed at `/`, the anonymous published feed at `/feed`, and the APIs at `/api/playlist` and `/api/video`. A ranking or parsing change affects all of them. `/feed` accepts either `playlist=` or a `videos=` id list.
- **Templates.** `stretch`, `balanced`, and `kids` each have their own scoring, classification, and reason text in `lib/learning.ts`. A change to one needs a decision for the others.
- **Playlist sources.** YouTube's RSS feed covers 15 videos. Larger playlists come from parsing the playlist page, which has two renderer formats (`playlistVideoRenderer` and `lockupViewModel`). Both parsers live in `lib/youtube-playlist.ts` and both need to keep working. As of September 2026 YouTube serves only lockups. Single videos and enrichment go through `parseWatchPage`, which reads the embedded player response.
- **Progress state.** Stored in `localStorage` under `LEARNING_STATE_KEY`. Changing its shape needs a migration path in `parseLearningState` so existing viewers do not lose progress.
- **Account state.** Usernames and owned playlists are stored in `localStorage` under `ACCOUNT_KEY` and parsed by `parseAccountStore` in `lib/account.ts`. There is no password and no server. Same migration rule applies.
- **Reverse states.** If you added a way in, add the way out. Mark complete needs unmark. Publish needs an obvious way to change the link.
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

The viewer submits a playlist URL. `app/api/playlist/route.ts` validates it with `playlistIdFrom`, fetches YouTube's RSS feed and, for larger requests, the playlist page, then parses both with `lib/youtube-playlist.ts`. The client ranks the resulting videos with `rankVideos` in `lib/learning.ts`, filtered by completed ids and shaped by the chosen template and the viewer's mastery. Feedback adjusts mastery and completed ids in `localStorage`. `/feed` reads the playlist, template, and size from the URL so a published link needs no server state.

Deployment: `npm run build` runs Vinext and the Cloudflare Vite plugin, which emit the Worker to `dist/server` and static assets to `dist/client`, plus a generated `dist/server/wrangler.json`. Worker configuration such as bindings and the custom domain route is set in `vite.config.ts` and flows into that generated file. Never edit `dist/` by hand.

## Where code lives

- `app/` - Next.js App Router pages and the API route. `app/page.tsx` is the interactive feed, `app/feed/` the published feed.
- `lib/learning.ts` - ranking, templates, and progress state. Pure functions, no I/O.
- `lib/youtube-playlist.ts` - URL validation, RSS, playlist page and watch page parsing. Pure functions over strings.
- `lib/account.ts` - username accounts and owned playlists. Pure functions plus the `localStorage` read and write.
- `components/` - React components. `components/ui/` is vendored shadcn; leave it verbatim.
- `tests/` - Vitest unit tests. Config in `vitest.config.ts`, kept separate from `vite.config.ts` so tests never load the Cloudflare plugin.
- `db/`, `drizzle/` - Drizzle schema for future D1 persistence. Not bound in production yet.
- `build/sites-vite-plugin.ts` - vendored OpenAI Sites dev-auth plugin. Do not edit.
- `scripts/` - install and run wrappers that handle the managed-Linux execution profile. Rarely need changes.
- `.github/workflows/ci.yml` - lint, typecheck, test, build, preview version per PR, production deploy on `main`.

## Taste

- Complexity belongs at the parsing boundary. Ranking stays pure, UI stays dumb.
- Inferred types over annotations. `any` is the enemy.
- Heuristics in `lib/learning.ts` are regex-and-weights on purpose. Do not introduce an ML model or external API for ranking without an explicit ask.
- Viewers are trying to focus. No continuously repainting animations, no layout shift when data arrives, no spinners that lie.
- If a rule here fights the task in front of you, say so loudly and get a human sign-off before breaking it.
