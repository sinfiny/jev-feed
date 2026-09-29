"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { Bookmark, Check, ChevronRight, ExternalLink, Link2, LoaderCircle, Moon, Plus, RotateCcw, RotateCw, Share2, Trash2, X } from "lucide-react";
import { QueueSidebar, type Selection } from "@/components/queue-sidebar";
import { YouTubePlayer, type Clip, type PlayerHandle } from "@/components/youtube-player";
import { formatDuration, type Video } from "@/lib/learning";
import {
  LIBRARY_KEY, SPEEDS, addBookmark, addPlaylist, addVideo, chapterAt, emptyProgress, labelBookmark, mergeVideoDetails, momentsFor,
  readLibrary, removeBookmark, removePlaylist, removeVideo, savePosition, toggleChapterDone, toggleStatus, videoState, writeLibrary, writeProgress,
  type LibraryPlaylist, type Moment, type Progress,
} from "@/lib/library";
import { playlistIdFrom } from "@/lib/youtube-playlist";

type ImportResult = { playlist?: { id: string; title: string }; videos?: Video[]; error?: string };
type VideoResult = { videos?: Video[]; error?: string };

declare global { interface Document { modelContext?: { registerTool: (tool: { name: string; title: string; description: string; inputSchema: object; annotations: { readOnlyHint: boolean; untrustedContentHint: boolean }; execute: (input: unknown) => Promise<unknown> }, options?: { signal?: AbortSignal }) => void | Promise<void> } } }

/** Seeded on a first visit so the layout has something in it. Details and chapters arrive through enrichment. */
const SAMPLE: { id: string; title: string; videos: Video[] } = {
  id: "PLZHQObOWTQDMsr9K-rj53DwVRMYO3t5Yr",
  title: "Essence of calculus",
  videos: [["WUvTyaaNkzM", "The essence of calculus"], ["9vKqVkMQHKk", "The paradox of the derivative"], ["kfF40MiS7zA", "Limits, L'Hôpital's rule, and epsilon delta definitions"]]
    .map(([id, title]) => ({ id, title, channel: "3Blue1Brown", description: "", thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` })),
};

const ENRICH_CHUNK = 10;
const SAVE_EVERY_SECONDS = 5;

async function fetchVideoDetails(ids: string[]) {
  const response = await fetch(`/api/video?ids=${encodeURIComponent(ids.join(","))}`);
  const result = await response.json().catch(() => ({ error: "The server returned an unexpected response." })) as VideoResult;
  if (!response.ok) throw new Error(result.error || "That video could not be read.");
  return result.videos ?? [];
}

async function fetchPlaylist(link: string) {
  const response = await fetch(`/api/playlist?url=${encodeURIComponent(link)}&limit=100`);
  const result = await response.json().catch(() => ({ error: "The server returned an unexpected response." })) as ImportResult;
  if (!response.ok || !result.playlist || !result.videos?.length) throw new Error(result.error || "That playlist did not contain any public videos.");
  return { playlist: result.playlist, videos: result.videos };
}

const isTyping = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

export default function Home() {
  const [playlists, setPlaylists] = useState<LibraryPlaylist[]>([]);
  const [progress, setProgress] = useState<Progress>(emptyProgress);
  const [loaded, setLoaded] = useState(false);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [clip, setClip] = useState<Clip | null>(null);
  const [chapterNow, setChapterNow] = useState<number | undefined>();
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const player = useRef<PlayerHandle>(null);
  const enrichAttempted = useRef(new Set<string>());

  const playlist = playlists.find((item) => item.id === selection?.playlistId);
  const video = playlist?.videos.find((item) => item.id === selection?.videoId);
  const videoProgress = video ? progress.videos[video.id] : undefined;
  const state = videoState(videoProgress);
  const chapter = video?.chapters?.find((item) => item.start === selection?.chapterStart);

  const say = useCallback((text: string, error = false) => setMessage({ text, error }), []);
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

  // Load the library, migrating the username-era store on the first visit after this change, and reopen the last video paused.
  useEffect(() => {
    const firstVisit = window.localStorage.getItem(LIBRARY_KEY) === null;
    const saved = readLibrary();
    const seeded = firstVisit && !saved.playlists.length ? addPlaylist([], SAMPLE.title, SAMPLE.videos, SAMPLE.id).playlists : saved.playlists;
    queueMicrotask(() => {
      setPlaylists(seeded); setProgress(saved.progress); setLoaded(true);
      const last = saved.progress.last;
      const target = seeded.find((item) => item.id === last?.playlistId)?.videos.find((item) => item.id === last?.videoId);
      if (last && target) {
        const position = saved.progress.videos[target.id]?.position ?? 0;
        setSelection(last); setClip({ videoId: target.id, start: position, autoplay: false, nonce: 0 }); setChapterNow(chapterAt(target, position)?.start);
      }
    });
  }, []);

  useEffect(() => { if (loaded) writeLibrary(playlists); }, [playlists, loaded]);
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

  const importPlaylist = useCallback(async (input: string) => {
    const { playlist: source, videos } = await fetchPlaylist(input);
    const existed = playlists.some((item) => item.sourcePlaylistId === source.id);
    const next = addPlaylist(playlists, source.title, videos, source.id);
    setPlaylists(next.playlists);
    say(`${existed ? "Refreshed" : "Added"} ${source.title} · ${videos.length} videos`);
    return { title: source.title, videoCount: videos.length };
  }, [playlists, say]);

  async function submitLink(event: FormEvent) {
    event.preventDefault();
    const input = link.trim();
    if (!input) return;
    setBusy(true);
    try {
      if (playlistIdFrom(input)) await importPlaylist(input);
      else {
        const [found] = await fetchVideoDetails([input]);
        if (!found) throw new Error("That video could not be read.");
        // A single video joins the open playlist, or a "Saved videos" playlist when nothing is open.
        const saved = playlist ?? playlists.find((item) => !item.sourcePlaylistId && item.title === "Saved videos");
        const { playlists: next, playlist: target } = saved ? { playlists, playlist: saved } : addPlaylist(playlists, "Saved videos", []);
        setPlaylists(addVideo(next, target.id, found));
        say(`Added “${found.title}”`);
      }
      setLink("");
    } catch (cause) { say(cause instanceof Error ? cause.message : "That link could not be added.", true); }
    finally { setBusy(false); }
  }

  useEffect(() => {
    if (!document.modelContext?.registerTool) return;
    const lifecycle = new AbortController();
    void Promise.resolve(document.modelContext.registerTool({
      name: "add_jev_playlist", title: "Add a playlist to Jev", description: "Import a public YouTube playlist into the viewer's Jev sidebar.",
      inputSchema: { type: "object", properties: { url: { type: "string" } }, required: ["url"], additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: async (input) => { const value = input as { url?: unknown }; if (typeof value.url !== "string") throw new Error("A playlist URL is required."); return importPlaylist(value.url); },
    }, { signal: lifecycle.signal })).catch(() => undefined);
    return () => lifecycle.abort();
  }, [importPlaylist]);

  function removeWholePlaylist(target: LibraryPlaylist) {
    if (!window.confirm(`Remove “${target.title}” from Jev? Your progress on its videos is kept.`)) return;
    setPlaylists(removePlaylist(playlists, target.id));
    if (selection?.playlistId === target.id) { setSelection(null); setClip(null); }
  }

  function removeOpenVideo() {
    if (!playlist || !video) return;
    setPlaylists(removeVideo(playlists, playlist.id, video.id));
    setSelection(null); setClip(null);
    say(`Removed “${video.title}” from ${playlist.title}`);
  }

  async function share() {
    if (!playlist) return;
    const params = new URLSearchParams({ videos: playlist.videos.map((item) => item.id).join(","), title: playlist.title });
    const url = `${window.location.origin}/feed?${params}`;
    try { await navigator.clipboard.writeText(url); say("Share link copied"); } catch { window.prompt("Copy this link", url); }
  }

  const moments = video ? momentsFor(video, videoProgress) : [];

  return <div className="flex min-h-screen flex-col bg-[var(--ink)] text-[var(--paper)] lg:grid lg:grid-cols-[340px_minmax(0,1fr)]">
    <aside className="order-2 border-white/10 px-3 pb-10 pt-4 lg:sticky lg:top-0 lg:order-1 lg:h-screen lg:overflow-y-auto lg:border-r">
      <div className="mb-4 flex items-center gap-2 px-1"><span className="grid size-7 place-items-center rounded-full bg-[var(--acid)] text-xs font-bold text-[var(--ink)]">J</span><span className="font-display text-lg">Jev</span></div>
      {loaded && <QueueSidebar playlists={playlists} progress={progress} selection={selection} onOpen={open} onToggleStatus={(id, status) => setProgress((current) => toggleStatus(current, id, status))} onRemovePlaylist={removeWholePlaylist}>
        <form onSubmit={submitLink} className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.04] pl-2 focus-within:border-white/25">
          <Link2 className="size-4 shrink-0 text-white/35" />
          <input value={link} onChange={(event) => setLink(event.target.value)} aria-label="YouTube playlist or video link" placeholder="Paste a playlist or video link" className="h-9 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-white/30" />
          <button type="submit" disabled={busy} aria-label="Add link" className="grid size-9 shrink-0 place-items-center rounded-r-lg text-white/60 hover:bg-white/10 hover:text-white">{busy ? <LoaderCircle className="size-4 animate-spin" /> : <Plus className="size-4" />}</button>
        </form>
      </QueueSidebar>}
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
            <button onClick={removeOpenVideo} className="flex items-center gap-1 hover:text-red-300"><Trash2 className="size-3.5" /> Remove from {playlist.title}</button>
          </div>
        </section>
      </div> : loaded && <div className="grid min-h-[50vh] place-items-center px-6 py-16 text-center lg:min-h-screen">
        <div className="max-w-sm">
          <p className="font-display text-2xl">{playlists.length ? "Pick a video" : "Start with a playlist"}</p>
          <p className="mt-2 text-sm leading-6 text-white/45">{playlists.length ? "Choose a video or one of its chapters from the list." : "Paste a YouTube playlist link into the box in the list. Jev copies it here, reads each video's chapters, and remembers where you stopped."}</p>
        </div>
      </div>}
    </main>

    {message && <p role="status" className={`fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-full px-4 py-2 text-sm shadow-lg ${message.error ? "bg-red-500 text-white" : "bg-white text-black"}`}>{message.text}</p>}
  </div>;
}
