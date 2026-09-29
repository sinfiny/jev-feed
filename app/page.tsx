"use client";

import { isTyping } from "@/lib/utils";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { UserButton, useAuth, useUser } from "@clerk/react";
import { Clapperboard, Library as LibraryIcon, RefreshCw, Sparkles } from "lucide-react";
import { Hint, Logo, Mascot, burst, burstFrom, useHints, type Mood } from "@/components/brand";
import { Landing } from "@/components/landing";
import { LibraryScreen, LibraryTree, orderPlaylist, type Selection } from "@/components/library";
import { Studio } from "@/components/studio";
import { lacksYouTube, useJev } from "@/components/use-jev";
import { Watch } from "@/components/watch";
import type { Clip, PlayerHandle } from "@/components/youtube-player";
import { formatDuration } from "@/lib/learning";
import { oauthErrorMessage } from "@/lib/auth";
import { PRESETS } from "@/lib/lens";
import { addVideos, createDraft } from "@/lib/feed";
import {
  SPEEDS, addBookmark, chapterAt, momentsFor, savePosition, setMembership, setPlaylistLens, toggleChapterDone, toggleStatus, videoState, type Moment,
} from "@/lib/library";
import { LIKED_PLAYLIST_ID, YOUTUBE_SCOPE } from "@/lib/youtube-account";

const SAVE_EVERY_SECONDS = 5;
type View = "watch" | "library" | "studio";
type Toast = { text: string; error?: boolean; action?: { label: string; run: () => void } };


export default function Home() {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return <div className="grid min-h-screen place-items-center bg-[var(--ink)]"><Mascot size={72} mood="calm" /></div>;
  return isSignedIn ? <App /> : <Landing />;
}

function App() {
  const [toast, setToast] = useState<Toast | null>(null);
  const say = useCallback((text: string, error = false, action?: Toast["action"]) => setToast({ text, error, action }), []);
  const jev = useJev(useCallback((problem: string) => say(problem, true), [say]));
  const { user } = useUser();
  const { playlists, progress, setProgress, setPlaylists, lenses: saved, judgments } = jev;
  const lenses = useMemo(() => [...PRESETS, ...saved], [saved]);
  const [view, setView] = useState<View>("watch");
  const [studioId, setStudioId] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [clip, setClip] = useState<Clip | null>(null);
  const [chapterNow, setChapterNow] = useState<number | undefined>();
  const [like, setLike] = useState<{ videoId: string; liked: boolean } | null>(null);
  const [connectingYouTube, setConnectingYouTube] = useState(false);
  const [mood, setMood] = useState<Mood>("calm");
  const player = useRef<PlayerHandle>(null);
  const lastSaved = useRef(0);
  const hints = useHints();

  const playlist = playlists.find((item) => item.id === selection?.playlistId);
  const video = playlist?.videos.find((item) => item.id === selection?.videoId);
  const chapter = video?.chapters?.find((item) => item.start === selection?.chapterStart);
  const liked = like && like.videoId === video?.id ? like.liked : undefined;
  const moments = video ? momentsFor(video, progress.videos[video.id]) : [];
  const upNext = useMemo(() => playlist && video ? orderPlaylist(playlist, progress, lenses.find((lens) => lens.id === playlist.lensId), judgments).filter((item) => item.video.id !== video.id && item.state !== "done").map((item) => item.video) : [], [playlist, video, progress, lenses, judgments]);

  const react = useCallback((next: Mood) => setMood(next), []);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(null), toast.error ? 6000 : toast.action ? 5000 : 2600); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => { if (mood === "calm") return; const timer = setTimeout(() => setMood("calm"), 2400); return () => clearTimeout(timer); }, [mood]);

  // The view lives in the URL so a refresh or a shared bookmark lands in the same place.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const wanted = params.get("view");
    queueMicrotask(() => { if (wanted === "studio" || wanted === "library") setView(wanted); setStudioId(params.get("feed")); });
  }, []);
  useEffect(() => {
    const params = new URLSearchParams();
    if (view !== "watch") params.set("view", view);
    if (view === "studio" && studioId) params.set("feed", studioId);
    const next = `${window.location.pathname}${params.size ? `?${params}` : ""}`;
    if (next !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(null, "", next);
  }, [view, studioId]);

  const open = useCallback((playlistId: string, videoId: string, moment?: Moment, autoplay = true) => {
    const target = playlists.find((item) => item.id === playlistId)?.videos.find((item) => item.id === videoId);
    if (!target) return;
    const saved = progress.videos[videoId];
    const resumeAt = saved?.status !== "done" && saved?.position && (!target.durationSeconds || saved.position < target.durationSeconds - 15) ? saved.position : 0;
    const start = moment ? moment.start : resumeAt;
    setSelection({ playlistId, videoId, chapterStart: moment?.kind === "chapter" ? moment.start : undefined });
    setClip({ videoId, start, end: moment?.kind === "chapter" ? moment.end : undefined, autoplay, nonce: Date.now() });
    setChapterNow(chapterAt(target, start)?.start);
    setProgress((current) => ({ ...current, last: { playlistId, videoId } }));
    lastSaved.current = start;
    setView("watch");
    if (!target.chapters?.length) void jev.enrich([target]);
    if (moment && window.innerWidth < 1024) window.scrollTo({ top: 0, behavior: "smooth" });
  }, [playlists, progress.videos, setProgress, jev]);

  // Reopen the last video, paused, once the saved library is in.
  const reopened = useRef(false);
  useEffect(() => {
    if (!jev.loaded || reopened.current) return;
    reopened.current = true;
    const last = progress.last;
    const target = playlists.find((item) => item.id === last?.playlistId)?.videos.find((item) => item.id === last?.videoId);
    if (last && target) queueMicrotask(() => {
      const position = progress.videos[target.id]?.position ?? 0;
      setSelection(last); setClip({ videoId: target.id, start: position, autoplay: false, nonce: 0 }); setChapterNow(chapterAt(target, position)?.start); lastSaved.current = position;
    });
  }, [jev.loaded, playlists, progress]);

  // Whether the open video is liked lives on YouTube, so it is asked for each time a video opens.
  useEffect(() => {
    if (!video) return;
    let stopped = false;
    jev.api<{ liked: boolean }>(`/api/account/like?id=${video.id}`).then(({ liked: value }) => { if (!stopped) setLike({ videoId: video.id, liked: value }); }, () => undefined);
    return () => { stopped = true; };
  }, [video, jev]);

  async function allowYouTube() {
    const google = user?.externalAccounts.find((item) => item.provider === "google");
    if (!google) { say("Your Google account is not connected. Sign out, then sign in again.", true); return; }
    setConnectingYouTube(true);
    try {
      const updated = await google.reauthorize({
        additionalScopes: [YOUTUBE_SCOPE],
        redirectUrl: window.location.origin,
        oidcLoginHint: google.emailAddress,
      });
      const next = updated.verification?.externalVerificationRedirectURL;
      if (!next) throw new Error("Google did not return an authorization page. Try again.");
      window.location.assign(next.toString());
    } catch (cause) {
      say(oauthErrorMessage(cause, "Google authorization could not start. Try again."), true);
      setConnectingYouTube(false);
    }
  }

  // Mirrors the like into the Liked playlist, except that a video open from Liked stays put until the next sync.
  const toggleLike = useCallback(async () => {
    if (!video || liked === undefined) return;
    const mirror = (value: boolean) => { if (value || playlist?.sourcePlaylistId !== LIKED_PLAYLIST_ID) setPlaylists((current) => setMembership(current, LIKED_PLAYLIST_ID, video, value)); };
    setLike({ videoId: video.id, liked: !liked }); mirror(!liked);
    if (!liked) react("love");
    try { await jev.api("/api/account/like", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: video.id, liked: !liked }) }); }
    catch (cause) { setLike({ videoId: video.id, liked }); mirror(liked); say(lacksYouTube(cause) ? "Jev needs YouTube access to like videos." : cause instanceof Error ? cause.message : "The like did not reach YouTube.", true); }
  }, [video, liked, playlist?.sourcePlaylistId, jev, say, setPlaylists, react]);

  const onTick = useCallback((seconds: number) => {
    if (!video) return;
    setChapterNow(chapterAt(video, seconds)?.start);
    if (Math.abs(seconds - lastSaved.current) >= SAVE_EVERY_SECONDS) { lastSaved.current = seconds; setProgress((current) => savePosition(current, video.id, seconds)); }
  }, [video, setProgress]);

  const onEnded = useCallback(() => {
    if (!selection) return;
    setProgress((current) => {
      const saved = current.videos[selection.videoId] ?? {};
      if (selection.chapterStart !== undefined) return saved.doneChapters?.includes(selection.chapterStart) ? current : toggleChapterDone(current, selection.videoId, selection.chapterStart);
      const reset = savePosition(current, selection.videoId, 0);
      return saved.status === "done" ? reset : toggleStatus(reset, selection.videoId, "done");
    });
    react("happy");
    burst(window.innerWidth / 2, window.innerHeight / 3, 28);
    const next = upNext[0];
    if (next && selection.chapterStart === undefined && playlist) say(selection.chapterStart === undefined ? "Finished! Nice." : "Chapter done!", false, { label: `Next: ${next.title.slice(0, 28)}${next.title.length > 28 ? "…" : ""}`, run: () => open(playlist.id, next.id) });
  }, [selection, setProgress, react, upNext, playlist, say, open]);

  const bookmark = useCallback(() => {
    if (!video) return;
    const seconds = player.current?.time() ?? 0;
    setProgress((current) => addBookmark(current, video.id, seconds).progress);
    hints.done("bookmark");
    react("wow");
    say(`Bookmarked ${formatDuration(Math.floor(seconds)) || "0:00"} — add a note below`);
  }, [video, say, setProgress, hints, react]);

  const setRate = useCallback((direction: 1 | -1) => setProgress((current) => {
    const index = SPEEDS.indexOf(current.rate as (typeof SPEEDS)[number]);
    return { ...current, rate: SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, index + direction))] };
  }), [setProgress]);

  /** Jumps inside the open video. In chapter mode this leaves the chapter and keeps playing the whole video. */
  const jump = useCallback((seconds: number) => {
    if (!video) return;
    lastSaved.current = seconds;
    if (selection?.chapterStart === undefined) { player.current?.seek(seconds); setChapterNow(chapterAt(video, seconds)?.start); return; }
    setSelection((current) => current && { ...current, chapterStart: undefined });
    setClip({ videoId: video.id, start: Math.max(0, seconds), autoplay: true, nonce: Date.now() });
    setChapterNow(chapterAt(video, seconds)?.start);
  }, [video, selection?.chapterStart]);

  const toggle = useCallback((videoId: string, status: "done" | "snoozed", from?: Element | null) => {
    const wasOn = progress.videos[videoId]?.status === status;
    setProgress((current) => toggleStatus(current, videoId, status));
    if (!wasOn) { react(status === "done" ? "happy" : "sleepy"); if (status === "done") burstFrom(from ?? null); }
  }, [progress.videos, setProgress, react]);

  // YouTube-style keys while the page (not the video frame) has focus.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!video || view !== "watch" || event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return;
      const actions: Record<string, () => void> = {
        b: bookmark, j: () => jump((player.current?.time() ?? 0) - 10), l: () => jump((player.current?.time() ?? 0) + 10), k: () => player.current?.togglePlay(), " ": () => player.current?.togglePlay(),
        "<": () => setRate(-1), ">": () => setRate(1), n: () => { if (upNext[0] && playlist) open(playlist.id, upNext[0].id); },
      };
      const action = actions[event.key.toLowerCase()];
      if (action && !(event.key === " " && event.target instanceof HTMLButtonElement)) { event.preventDefault(); action(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [video, view, bookmark, jump, setRate, upNext, playlist, open]);

  function addToFeed(draftId: string | null) {
    if (!video) return;
    if (draftId) {
      const draft = jev.drafts.find((item) => item.id === draftId);
      jev.setDrafts((all) => all.map((item) => item.id === draftId ? { ...addVideos(item, [video]), updatedAt: Date.now() } : item));
      say(`Added to ${draft?.title || "your feed"}`, false, { label: "Open Studio", run: () => { setStudioId(draftId); setView("studio"); } });
    } else {
      const made = createDraft("", [video]);
      jev.setDrafts((all) => [made, ...all]);
      say("Started a new feed", false, { label: "Name it", run: () => { setStudioId(made.id); setView("studio"); } });
    }
    react("love");
  }

  const tree = <LibraryTree playlists={playlists} progress={progress} lenses={lenses} judgments={judgments} selection={selection} onOpen={open}
    onToggleStatus={(id, status) => toggle(id, status)} onLens={(id, lensId) => setPlaylists((current) => setPlaylistLens(current, id, lensId))} />;

  const syncChip = jev.sync ? <span className="flex items-center gap-1.5 truncate text-xs text-white/50"><RefreshCw className="size-3 shrink-0 animate-spin" />{jev.sync.label}{jev.sync.total ? ` · ${jev.sync.done}/${jev.sync.total}` : "…"}</span>
    : <button onClick={() => void jev.refresh()} title="Check YouTube for new videos" className="flex items-center gap-1.5 text-xs text-white/35 hover:text-white"><RefreshCw className="size-3" /> Up to date</button>;

  const permission = jev.needsYouTube && <div className="flex items-start gap-3 rounded-2xl border-2 border-[var(--sun)]/40 bg-[var(--sun)]/10 p-3 text-sm">
    <Mascot size={36} mood="sad" /><div><p className="text-white/80">Jev needs permission to read your YouTube playlists and likes.</p>
      <button onClick={allowYouTube} disabled={connectingYouTube} className="juicy mt-2 h-9 px-3 text-sm" style={{ "--tone": "var(--sun)" } as React.CSSProperties}>{connectingYouTube ? "Opening Google…" : "Allow YouTube access"}</button></div>
  </div>;

  const empty = <div className="grid min-h-[60vh] place-items-center px-6 py-16 text-center lg:min-h-screen">
    <div className="max-w-sm">
      <Mascot size={120} mood={playlists.length ? "wink" : jev.needsYouTube ? "sad" : jev.sync ? "think" : "sleepy"} className="mx-auto" />
      <p className="mt-4 font-display text-3xl">{playlists.length ? "Pick something to watch" : jev.needsYouTube ? "One more step" : jev.sync ? "Reading your YouTube…" : "Nothing here yet"}</p>
      <p className="mt-2 text-sm leading-6 text-white/50">{playlists.length ? <>Choose a video, or open one straight at a chapter. Or head to the <button onClick={() => setView("studio")} className="font-bold text-[var(--pink)] underline decoration-dotted underline-offset-2">Studio</button> to make a feed for someone.</> : jev.needsYouTube ? "Allow YouTube access so Jev can read your playlists and likes." : jev.sync ? "Liked videos and your playlists land here one by one." : "Like a video or save one to a playlist on YouTube and it shows up here."}</p>
      {!!playlists.length && <button onClick={() => { const first = playlists[0]; const next = orderPlaylist(first, progress, lenses.find((lens) => lens.id === first.lensId), judgments).find((item) => item.state !== "done"); if (next) open(first.id, next.video.id); }}
        className="juicy mt-6 h-12 px-5 lg:hidden">Start watching</button>}
    </div>
  </div>;

  const deckHint = hints.showing("bookmark") && video ? <Hint onClose={() => hints.done("bookmark")}>Press <span className="kbd bg-black/10">B</span> (or the yellow button) to bookmark a moment. Bookmarks become places to start, right next to chapters.</Hint> : undefined;

  const main = view === "studio"
    ? <Studio jev={jev} author={user?.firstName ?? undefined} say={say} openId={studioId} setOpenId={setStudioId} />
    : view === "library"
      ? <div className="mx-auto max-w-3xl"><div className="px-4 pb-3 pt-4"><h1 className="font-display text-3xl">Library</h1><div className="mt-1">{syncChip}</div>{permission && <div className="mt-3">{permission}</div>}</div>
        <LibraryScreen playlists={playlists} progress={progress} lenses={lenses} judgments={judgments} selection={selection} onOpen={open} onToggleStatus={(id, status) => toggle(id, status)} onLens={(id, lensId) => setPlaylists((current) => setPlaylistLens(current, id, lensId))} /></div>
      : video && clip && playlist
        ? <Watch player={player} playlist={playlist} video={video} clip={clip} chapter={chapter} chapterNow={chapterNow} moments={moments} progress={progress} setProgress={setProgress}
          upNext={upNext} liked={liked} onLike={toggleLike} onOpen={(videoId, moment) => open(playlist.id, videoId, moment)} onJump={jump} onTick={onTick} onEnded={onEnded} onBookmark={bookmark}
          onToggle={(status, from) => toggle(video.id, status, from)} drafts={jev.drafts} onAddToFeed={addToFeed} deckHint={deckHint} />
        : jev.loaded ? empty : null;

  const status = video ? videoState(progress.videos[video.id]) : "new";
  const tabs: Array<{ id: View; label: string; icon: React.ReactNode }> = [
    { id: "watch", label: "Watch", icon: <Clapperboard className="size-5" /> },
    { id: "library", label: "Library", icon: <LibraryIcon className="size-5" /> },
    { id: "studio", label: "Studio", icon: <Sparkles className="size-5" /> },
  ];

  return <div className="min-h-screen bg-[var(--ink)] text-[var(--paper)] lg:grid lg:grid-cols-[340px_minmax(0,1fr)]">
    <aside className="hidden border-r-2 border-black/40 bg-[var(--ink)] lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col">
      <div className="flex items-center gap-2 px-4 pb-3 pt-4">
        <span key={mood} className={mood === "calm" ? "" : "animate-bounce-once"}><Logo size={34} mood={mood} /></span>
        <span className="flex-1" />
        <UserButton />
      </div>
      <div role="tablist" aria-label="Sections" className="mx-4 flex rounded-2xl bg-white/[0.06] p-1">
        {tabs.filter((tab) => tab.id !== "library").map((tab) => <button key={tab.id} role="tab" aria-selected={view === tab.id} onClick={() => setView(tab.id)}
          className={`flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl text-sm font-bold transition ${view === tab.id || (tab.id === "watch" && view === "library") ? tab.id === "studio" ? "bg-[var(--pink)] text-[var(--ink)]" : "bg-[var(--lime)] text-[var(--ink)]" : "text-white/55 hover:text-white"}`}>{tab.icon}{tab.label}</button>)}
      </div>
      <div className="flex items-center px-4 pb-2 pt-3">{syncChip}</div>
      {permission && <div className="px-3 pb-3">{permission}</div>}
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-2 pb-8">{jev.loaded ? tree : null}</div>
    </aside>

    <div className="min-w-0">
      <header className={`flex items-center gap-2 px-4 py-2.5 lg:hidden ${view === "watch" && video ? "hidden" : ""}`}>
        <span key={mood} className={mood === "calm" ? "" : "animate-bounce-once"}><Logo size={30} mood={mood} /></span>
        <span className="min-w-0 flex-1 pl-2">{view !== "library" && jev.sync && syncChip}</span>
        <UserButton />
      </header>
      <main className="min-w-0">{main}</main>
    </div>

    <nav aria-label="Sections" className="fixed inset-x-3 bottom-3 z-40 flex rounded-3xl border-2 border-black/70 bg-[var(--ink-3)]/95 p-1.5 shadow-[0_6px_0_#000c] backdrop-blur lg:hidden">
      {tabs.map((tab) => <button key={tab.id} onClick={() => setView(tab.id)} aria-current={view === tab.id ? "page" : undefined}
        className={`relative flex h-12 flex-1 flex-col items-center justify-center gap-0.5 rounded-2xl text-[11px] font-bold transition ${view === tab.id ? tab.id === "studio" ? "bg-[var(--pink)] text-[var(--ink)]" : "bg-[var(--lime)] text-[var(--ink)]" : "text-white/55 active:scale-95"}`}>
        {tab.icon}{tab.label}
        {tab.id === "watch" && video && view !== "watch" && <span className={`absolute right-[22%] top-1.5 size-2 rounded-full ${status === "done" ? "bg-[var(--lime)]" : "bg-[var(--sun)]"}`} />}
      </button>)}
    </nav>

    {toast && <div role="status" className={`animate-pop fixed bottom-24 left-1/2 z-[80] flex max-w-[92vw] -translate-x-1/2 items-center gap-2 rounded-2xl border-2 border-black/70 py-2 pl-4 pr-2 text-sm font-semibold shadow-[0_5px_0_#000c] lg:bottom-6 ${toast.error ? "bg-[var(--tomato)] text-white" : "bg-[var(--paper)] text-[var(--ink)]"}`}>
      <span className="min-w-0 truncate">{toast.text}</span>
      {toast.action ? <button onClick={() => { toast.action!.run(); setToast(null); }} className="shrink-0 rounded-xl bg-[var(--ink)] px-3 py-1.5 text-xs font-bold text-[var(--paper)]">{toast.action.label}</button> : <span className="pr-2" />}
    </div>}
  </div>;
}
