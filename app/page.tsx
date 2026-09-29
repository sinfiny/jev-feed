"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { UserButton, useAuth, useSignIn, useUser } from "@clerk/react";
import { Bookmark, Check, ChevronRight, ExternalLink, Moon, RotateCcw, RotateCw, Share2, ThumbsUp, X } from "lucide-react";
import { QueueSidebar, type Selection } from "@/components/queue-sidebar";
import { YouTubePlayer, type Clip, type PlayerHandle } from "@/components/youtube-player";
import { formatDuration, type Video } from "@/lib/learning";
import {
  SPEEDS, addBookmark, chapterAt, emptyProgress, labelBookmark, mergeVideoDetails, momentsFor, readLibrary, removeBookmark,
  savePosition, setMembership, syncPlaylists, toggleChapterDone, toggleStatus, videoState, writeLibrary, writeProgress,
  type Moment, type Progress, type LibraryPlaylist,
} from "@/lib/library";
import { LIKED_PLAYLIST_ID, YOUTUBE_SCOPE, type AccountPlaylist } from "@/lib/youtube-account";

type VideoResult = { videos?: Video[]; error?: string };

/** A failed call to app/api/account. 403 means the Google sign-in lacks YouTube access. */
class AccountError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
const lacksYouTube = (cause: unknown) => cause instanceof AccountError && cause.status === 403;

const ENRICH_CHUNK = 10;
const SAVE_EVERY_SECONDS = 5;

async function fetchVideoDetails(ids: string[]) {
  const response = await fetch(`/api/video?ids=${encodeURIComponent(ids.join(","))}`);
  const result = await response.json().catch(() => ({ error: "The server returned an unexpected response." })) as VideoResult;
  if (!response.ok) throw new Error(result.error || "That video could not be read.");
  return result.videos ?? [];
}

/** The one way in. Google is the only sign-in method on the Clerk instance, so a first visit signs up here too. */
function SignInScreen() {
  const { signIn } = useSignIn();
  const [error, setError] = useState("");
  async function start() {
    setError("");
    const { error: failed } = await signIn.sso({ strategy: "oauth_google", redirectUrl: "/", redirectCallbackUrl: "/sso-callback" });
    if (failed) setError(failed.message || "Google sign-in could not start. Try again.");
  }
  return <div className="grid min-h-screen place-items-center bg-[var(--ink)] px-6 text-center text-[var(--paper)]">
    <div className="max-w-sm">
      <span className="mx-auto grid size-10 place-items-center rounded-full bg-[var(--acid)] text-base font-bold text-[var(--ink)]">J</span>
      <p className="mt-5 font-display text-3xl">Jev</p>
      <p className="mt-2 text-sm leading-6 text-white/50">Your YouTube playlists and liked videos, one chapter at a time. Progress and bookmarks stay in this browser.</p>
      <button onClick={start} className="mt-7 inline-flex h-11 items-center gap-2.5 rounded-full bg-white px-5 text-sm font-semibold text-black hover:bg-white/90">
        <svg aria-hidden viewBox="0 0 48 48" className="size-4"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.6c0-1.6-.1-3.1-.4-4.6H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.8c4.3-4 6.9-9.9 6.9-17.1z"/><path fill="#FBBC05" d="M10.6 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.8c-2.1 1.4-4.8 2.3-8.5 2.3-6.2 0-11.5-4.1-13.4-9.9l-7.9 6.1C6.6 42.6 14.6 48 24 48z"/></svg>
        Continue with Google
      </button>
      {error && <p role="alert" className="mt-4 text-sm text-red-300">{error}</p>}
    </div>
  </div>;
}

const isTyping = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

export default function Home() {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return <div className="min-h-screen bg-[var(--ink)]" />;
  return isSignedIn ? <Library /> : <SignInScreen />;
}

function Library() {
  const { getToken } = useAuth();
  const { user } = useUser();
  const [needsYouTube, setNeedsYouTube] = useState(false);
  const [playlists, setPlaylists] = useState<LibraryPlaylist[]>([]);
  const [progress, setProgress] = useState<Progress>(emptyProgress);
  const [loaded, setLoaded] = useState(false);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [clip, setClip] = useState<Clip | null>(null);
  const [chapterNow, setChapterNow] = useState<number | undefined>();
  const [syncing, setSyncing] = useState(true);
  const [like, setLike] = useState<{ videoId: string; liked: boolean } | null>(null);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const player = useRef<PlayerHandle>(null);
  const enrichAttempted = useRef(new Set<string>());

  const playlist = playlists.find((item) => item.id === selection?.playlistId);
  const video = playlist?.videos.find((item) => item.id === selection?.videoId);
  const videoProgress = video ? progress.videos[video.id] : undefined;
  const state = videoState(videoProgress);
  const chapter = video?.chapters?.find((item) => item.start === selection?.chapterStart);

  const liked = like && like.videoId === video?.id ? like.liked : undefined;

  const say = useCallback((text: string, error = false) => setMessage({ text, error }), []);

  /** Same-origin calls to app/api/account, which read the viewer's Clerk session to act on their YouTube account. */
  const account = useCallback(async <T,>(path: string, init: RequestInit = {}) => {
    const response = await fetch(path, { ...init, headers: { ...init.headers, Authorization: `Bearer ${await getToken()}` } });
    const result = await response.json().catch(() => ({ error: "The server returned an unexpected response." })) as T & { error?: string };
    if (!response.ok) throw new AccountError(result.error || "Your YouTube account could not be reached.", response.status);
    return result;
  }, [getToken]);
  useEffect(() => { if (!message) return; const timer = setTimeout(() => setMessage(null), message.error ? 6000 : 2500); return () => clearTimeout(timer); }, [message]);

  const open = useCallback((playlistId: string, videoId: string, moment?: Moment, autoplay = true) => {
    const target = playlists.find((item) => item.id === playlistId)?.videos.find((item) => item.id === videoId);
    if (!target) return;
    const saved = progress.videos[videoId];
    const resumeAt = saved?.status !== "done" && saved?.position && (!target.durationSeconds || saved.position < target.durationSeconds - 15) ? saved.position : 0;
    const start = moment ? moment.start : resumeAt;
    const end = moment?.kind === "chapter" ? moment.end : undefined;
    setSelection({ playlistId, videoId, chapterStart: moment?.kind === "chapter" ? moment.start : undefined });
    setClip({ videoId, start, end, autoplay, nonce: Date.now() });
    setChapterNow(chapterAt(target, start)?.start);
    setProgress((current) => ({ ...current, last: { playlistId, videoId } }));
  }, [playlists, progress.videos]);

  // Show the library saved in this browser at once, migrating the username-era store on the first visit after that change,
  // and reopen the last video paused. The account sync below then refreshes it.
  useEffect(() => {
    const saved = readLibrary();
    queueMicrotask(() => {
      setPlaylists(saved.playlists); setProgress(saved.progress); setLoaded(true);
      const last = saved.progress.last;
      const target = saved.playlists.find((item) => item.id === last?.playlistId)?.videos.find((item) => item.id === last?.videoId);
      if (last && target) {
        const position = saved.progress.videos[target.id]?.position ?? 0;
        setSelection(last); setClip({ videoId: target.id, start: position, autoplay: false, nonce: 0 }); setChapterNow(chapterAt(target, position)?.start);
      }
    });
  }, []);

  useEffect(() => { if (loaded) writeLibrary(playlists); }, [playlists, loaded]);

  // Refresh the library from the viewer's YouTube account: Liked videos and their own playlists.
  // A playlist that fails to load keeps the copy already in the browser.
  useEffect(() => {
    if (!loaded) return;
    let stopped = false;
    (async () => {
      try {
        const { playlists: sources } = await account<{ playlists: AccountPlaylist[] }>("/api/account/playlists");
        const results = await Promise.all(sources.map((source) => account<{ videos: Video[] }>(`/api/account/playlist?id=${encodeURIComponent(source.id)}`)
          .then(({ videos }) => ({ source, videos }), () => ({ source, videos: null }))));
        if (stopped) return;
        setPlaylists((current) => syncPlaylists(current, results.flatMap(({ source, videos }) => {
          const kept = videos ?? current.find((item) => item.sourcePlaylistId === source.id)?.videos ?? [];
          return kept.length ? [{ ...source, videos: kept }] : [];
        })));
        if (results.some((result) => !result.videos)) say("Some playlists could not be refreshed.", true);
      } catch (cause) {
        if (stopped) return;
        if (lacksYouTube(cause)) setNeedsYouTube(true);
        else say(cause instanceof Error ? cause.message : "Your playlists could not be loaded.", true);
      }
      finally { if (!stopped) setSyncing(false); }
    })();
    return () => { stopped = true; };
  }, [loaded, account, say]);

  // Whether the open video is liked lives on YouTube, so it is asked for each time a video opens.
  useEffect(() => {
    if (!video) return;
    let stopped = false;
    account<{ liked: boolean }>(`/api/account/like?id=${video.id}`).then(({ liked: value }) => { if (!stopped) setLike({ videoId: video.id, liked: value }); }, (cause) => { if (!stopped && lacksYouTube(cause)) setNeedsYouTube(true); });
    return () => { stopped = true; };
  }, [video, account]);

  // Someone who unticked YouTube on Google's consent screen is signed in but can't load anything. This asks Google again for that one scope.
  async function allowYouTube() {
    const google = user?.externalAccounts.find((item) => item.provider === "google");
    if (!google) return;
    try {
      const updated = await google.reauthorize({ additionalScopes: [YOUTUBE_SCOPE], redirectUrl: window.location.href });
      const next = updated.verification?.externalVerificationRedirectURL;
      if (next) window.location.assign(next.toString());
    } catch { say("Google did not open. Try again.", true); }
  }

  // Mirrors the like into the Liked playlist, except that a video open from Liked stays put until the next sync.
  const toggleLike = useCallback(async () => {
    if (!video || liked === undefined) return;
    const mirror = (value: boolean) => { if (value || playlist?.sourcePlaylistId !== LIKED_PLAYLIST_ID) setPlaylists((current) => setMembership(current, LIKED_PLAYLIST_ID, video, value)); };
    setLike({ videoId: video.id, liked: !liked }); mirror(!liked);
    try { await account("/api/account/like", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: video.id, liked: !liked }) }); }
    catch (cause) { setLike({ videoId: video.id, liked }); mirror(liked); if (lacksYouTube(cause)) setNeedsYouTube(true); say(cause instanceof Error ? cause.message : "The like did not reach YouTube.", true); }
  }, [video, liked, playlist?.sourcePlaylistId, account, say]);
  useEffect(() => { if (loaded) writeProgress(progress); }, [progress, loaded]);

  // Videos imported from a playlist page arrive without a description, so chapters are read from each watch page in small batches.
  // The open video goes first. Results merge into every playlist that holds the video.
  useEffect(() => {
    const seen = new Set<string>();
    const missing = [...(video ? [video] : []), ...playlists.flatMap((item) => item.videos)]
      .filter((item) => !item.description && !enrichAttempted.current.has(item.id) && !seen.has(item.id) && !!seen.add(item.id))
      .map((item) => item.id);
    if (!missing.length) return;
    const attempted = enrichAttempted.current;
    missing.forEach((id) => attempted.add(id));
    let stopped = false;
    let fetched = 0;
    (async () => {
      for (; fetched < missing.length && !stopped; fetched += ENRICH_CHUNK) {
        const details = await fetchVideoDetails(missing.slice(fetched, fetched + ENRICH_CHUNK)).catch(() => [] as Video[]);
        setPlaylists((current) => mergeVideoDetails(current, details));
      }
    })();
    // A library change stops the loop after its current batch; ids not yet fetched are picked up by the next run.
    return () => { stopped = true; missing.slice(fetched + ENRICH_CHUNK).forEach((id) => attempted.delete(id)); };
  }, [playlists, video]);

  // Track the current chapter and save the playback position so the video resumes where it stopped.
  useEffect(() => {
    if (!video) return;
    let lastSaved = videoProgress?.position ?? 0;
    const tick = setInterval(() => {
      const seconds = player.current?.time() ?? 0;
      if (!seconds) return;
      setChapterNow(chapterAt(video, seconds)?.start);
      if (Math.abs(seconds - lastSaved) >= SAVE_EVERY_SECONDS) { lastSaved = seconds; setProgress((current) => savePosition(current, video.id, seconds)); }
    }, 1000);
    return () => clearInterval(tick);
    // Restart only when a different video opens, not on every progress write.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [video?.id]);

  const onEnded = useCallback(() => {
    if (!selection) return;
    setProgress((current) => {
      const saved = current.videos[selection.videoId] ?? {};
      if (selection.chapterStart !== undefined) return saved.doneChapters?.includes(selection.chapterStart) ? current : toggleChapterDone(current, selection.videoId, selection.chapterStart);
      const reset = savePosition(current, selection.videoId, 0);
      return saved.status === "done" ? reset : toggleStatus(reset, selection.videoId, "done");
    });
  }, [selection]);

  const bookmark = useCallback(() => {
    if (!video) return;
    const seconds = player.current?.time() ?? 0;
    setProgress((current) => addBookmark(current, video.id, seconds).progress);
    say(`Bookmarked ${formatDuration(Math.floor(seconds)) || "0:00"}`);
  }, [video, say]);

  const setRate = useCallback((direction: 1 | -1) => setProgress((current) => {
    const index = SPEEDS.indexOf(current.rate as (typeof SPEEDS)[number]);
    return { ...current, rate: SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, index + direction))] };
  }), []);

  /** Jumps inside the open video. In chapter mode this leaves the chapter and keeps playing the whole video. */
  const jump = useCallback((seconds: number) => {
    if (!video) return;
    if (selection?.chapterStart === undefined) { player.current?.seek(seconds); setChapterNow(chapterAt(video, seconds)?.start); return; }
    setSelection((current) => current && { ...current, chapterStart: undefined });
    setClip({ videoId: video.id, start: Math.max(0, seconds), autoplay: true, nonce: Date.now() });
    setChapterNow(chapterAt(video, seconds)?.start);
  }, [video, selection?.chapterStart]);

  const skip = useCallback((delta: number) => jump((player.current?.time() ?? 0) + delta), [jump]);

  // YouTube-style keys while the page (not the video frame) has focus: B bookmarks, J and L skip 10s, K plays or pauses, < and > change speed.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!video || event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return;
      const actions: Record<string, () => void> = { b: bookmark, j: () => skip(-10), l: () => skip(10), k: () => player.current?.togglePlay(), "<": () => setRate(-1), ">": () => setRate(1) };
      const action = actions[event.key.toLowerCase()];
      if (action) { event.preventDefault(); action(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [video, bookmark, skip, setRate]);

  async function share() {
    if (!playlist) return;
    const params = new URLSearchParams({ videos: playlist.videos.map((item) => item.id).join(","), title: playlist.title });
    const url = `${window.location.origin}/feed?${params}`;
    try { await navigator.clipboard.writeText(url); say("Share link copied"); } catch { window.prompt("Copy this link", url); }
  }

  const moments = video ? momentsFor(video, videoProgress) : [];

  return <div className="flex min-h-screen flex-col bg-[var(--ink)] text-[var(--paper)] lg:grid lg:grid-cols-[340px_minmax(0,1fr)]">
    <aside className="order-2 border-white/10 px-3 pb-10 pt-4 lg:sticky lg:top-0 lg:order-1 lg:h-screen lg:overflow-y-auto lg:border-r">
      <div className="mb-4 flex items-center gap-2 px-1"><span className="grid size-7 place-items-center rounded-full bg-[var(--acid)] text-xs font-bold text-[var(--ink)]">J</span><span className="font-display text-lg">Jev</span><span className="ml-auto grid size-7 place-items-center"><UserButton /></span></div>
      {needsYouTube && <div className="mb-4 rounded-xl border border-white/10 bg-white/[0.04] p-3 text-sm">
        <p className="text-white/70">Jev needs your permission to read your YouTube playlists and likes.</p>
        <button onClick={allowYouTube} className="mt-2 h-8 rounded-lg bg-white px-3 font-semibold text-black hover:bg-white/90">Allow YouTube access</button>
      </div>}
      {loaded && <QueueSidebar playlists={playlists} progress={progress} selection={selection} onOpen={open} onToggleStatus={(id, status) => setProgress((current) => toggleStatus(current, id, status))} />}
    </aside>

    <main className="order-1 min-w-0 lg:order-2">
      {video && clip && playlist ? <div className="mx-auto max-w-5xl px-0 pb-10 sm:px-6 sm:pt-5">
        <div className="flex items-center gap-1.5 px-4 py-3 text-sm text-white/45 sm:px-0 sm:pt-0">
          <span className="truncate">{playlist.title}</span><ChevronRight className="size-3.5 shrink-0" />
          <span className={`truncate ${chapter ? "" : "text-white"}`}>{video.title}</span>
          {chapter && <><ChevronRight className="size-3.5 shrink-0" /><span className="truncate text-white">{chapter.title}</span></>}
          <button onClick={share} aria-label="Copy a share link for this playlist" className="ml-auto flex shrink-0 items-center gap-1 rounded-md px-2 py-1 hover:bg-white/10 hover:text-white" title="Copy a share link for this playlist"><Share2 className="size-3.5" /><span className="hidden sm:inline">Share</span></button>
        </div>

        <div className="overflow-hidden bg-black sm:rounded-xl"><YouTubePlayer ref={player} clip={clip} rate={progress.rate} onEnded={onEnded} /></div>

        <div className="flex flex-wrap items-center gap-2 px-4 py-3 sm:px-0">
          <div role="group" aria-label="Playback speed" className="flex rounded-lg bg-white/[0.06] p-0.5">{SPEEDS.map((speed) => <button key={speed} onClick={() => setProgress((current) => ({ ...current, rate: speed }))} aria-pressed={progress.rate === speed} className={`h-8 min-w-11 rounded-md px-2 text-sm tabular-nums ${progress.rate === speed ? "bg-white text-black" : "text-white/60 hover:text-white"}`}>{speed}×</button>)}</div>
          <div className="flex rounded-lg bg-white/[0.06] p-0.5">
            <button onClick={() => skip(-10)} aria-label="Back 10 seconds" title="Back 10s (J)" className="grid size-8 place-items-center rounded-md text-white/60 hover:text-white"><RotateCcw className="size-4" /></button>
            <button onClick={() => skip(10)} aria-label="Forward 10 seconds" title="Forward 10s (L)" className="grid size-8 place-items-center rounded-md text-white/60 hover:text-white"><RotateCw className="size-4" /></button>
          </div>
          <button onClick={bookmark} title="Bookmark this moment (B)" className="flex h-9 items-center gap-1.5 rounded-lg bg-[var(--acid)] px-3 text-sm font-semibold text-[var(--ink)] hover:bg-[var(--acid-bright)]"><Bookmark className="size-4" /> Bookmark <kbd className="hidden rounded bg-black/15 px-1 text-[11px] sm:inline">B</kbd></button>
          {chapter && <button onClick={() => jump(player.current?.time() ?? chapter.start)} title="Play on past the end of this chapter" className="h-9 rounded-lg px-3 text-sm text-white/60 hover:bg-white/10 hover:text-white">Keep watching</button>}
          <div className="ml-auto flex items-center gap-1">
            <button onClick={toggleLike} disabled={liked === undefined} aria-pressed={!!liked} title={liked ? "Take back your like on YouTube" : "Like on YouTube"} className={`flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm disabled:opacity-40 ${liked ? "bg-white/15 text-white" : "text-white/60 hover:bg-white/10 hover:text-white"}`}><ThumbsUp className={`size-4 ${liked ? "fill-current" : ""}`} /> {liked ? "Liked" : "Like"}</button>
            <button onClick={() => setProgress((current) => toggleStatus(current, video.id, "snoozed"))} aria-pressed={state === "snoozed"} className={`flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm ${state === "snoozed" ? "bg-white/15 text-white" : "text-white/60 hover:bg-white/10 hover:text-white"}`}><Moon className="size-4" /> {state === "snoozed" ? "Snoozed" : "Snooze"}</button>
            <button onClick={() => setProgress((current) => toggleStatus(current, video.id, "done"))} aria-pressed={state === "done"} className={`flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm ${state === "done" ? "bg-[var(--acid)]/15 text-[var(--acid)]" : "text-white/60 hover:bg-white/10 hover:text-white"}`}><Check className="size-4" /> {state === "done" ? "Done" : "Mark done"}</button>
          </div>
        </div>

        <section className="px-4 sm:px-0">
          <h2 className="font-display text-xl leading-tight sm:text-2xl">{video.title}</h2>
          <p className="mt-1 text-sm text-white/45">{[video.channel, formatDuration(video.durationSeconds)].filter(Boolean).join(" · ")}</p>

          <h3 className="mt-6 text-xs font-semibold uppercase tracking-[.14em] text-white/40">Chapters and bookmarks</h3>
          {moments.length ? <ul className="mt-2 divide-y divide-white/[0.06] rounded-xl border border-white/10">{moments.map((moment) => {
            const current = moment.kind === "chapter" && moment.start === chapterNow;
            return <li key={moment.kind === "bookmark" ? moment.id : `c${moment.start}`} className={`flex items-center gap-2 px-2 ${current ? "bg-white/[0.06]" : ""}`}>
              <button onClick={() => jump(moment.start)} className="w-14 shrink-0 py-2.5 text-left text-sm tabular-nums text-[var(--acid)] hover:underline">{formatDuration(moment.start) || "0:00"}</button>
              {moment.kind === "chapter"
                ? <><button onClick={() => jump(moment.start)} className={`min-w-0 flex-1 truncate py-2.5 text-left text-sm ${moment.done ? "text-white/45 line-through decoration-white/30" : ""}`}>{moment.title}</button>
                  <button onClick={() => setProgress((current) => toggleChapterDone(current, video.id, moment.start))} aria-pressed={moment.done} aria-label={moment.done ? `Mark ${moment.title} not done` : `Mark ${moment.title} done`} className={`grid size-8 shrink-0 place-items-center rounded-md hover:bg-white/10 ${moment.done ? "text-[var(--acid)]" : "text-white/25"}`}><Check className="size-4" /></button></>
                : <><Bookmark className="size-3.5 shrink-0 text-[var(--acid)]" />
                  <input value={moment.title} onChange={(event) => setProgress((current) => labelBookmark(current, video.id, moment.id, event.target.value))} aria-label={`Note for bookmark at ${formatDuration(moment.start) || "0:00"}`} placeholder="Add a note" className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-white/30" />
                  <button onClick={() => setProgress((current) => removeBookmark(current, video.id, moment.id))} aria-label="Delete bookmark" className="grid size-8 shrink-0 place-items-center rounded-md text-white/30 hover:bg-red-500/15 hover:text-red-300"><X className="size-4" /></button></>}
            </li>;
          })}</ul> : <p className="mt-2 text-sm text-white/40">{video.description ? "This video has no chapters. Press B while it plays to bookmark a moment." : "Looking for chapters…"}</p>}

          <div className="mt-6 flex flex-wrap gap-4 text-sm text-white/40">
            <a href={`https://www.youtube.com/watch?v=${video.id}`} target="_blank" rel="noreferrer" className="flex items-center gap-1 hover:text-white">Open on YouTube <ExternalLink className="size-3.5" /></a>
          </div>
        </section>
      </div> : loaded && <div className="grid min-h-[50vh] place-items-center px-6 py-16 text-center lg:min-h-screen">
        <div className="max-w-sm">
          <p className="font-display text-2xl">{playlists.length ? "Pick a video" : needsYouTube ? "Allow YouTube access" : syncing ? "Loading your playlists" : "Nothing to watch yet"}</p>
          <p className="mt-2 text-sm leading-6 text-white/45">{playlists.length ? "Choose a video or one of its chapters from the list." : needsYouTube ? "Use the button in the list so Jev can read your playlists and likes." : syncing ? "Reading Liked videos and your playlists from YouTube." : "Like a video or save one to a playlist on YouTube and it shows up here on your next visit."}</p>
        </div>
      </div>}
    </main>

    {message && <p role="status" className={`fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-full px-4 py-2 text-sm shadow-lg ${message.error ? "bg-red-500 text-white" : "bg-white text-black"}`}>{message.text}</p>}
  </div>;
}
