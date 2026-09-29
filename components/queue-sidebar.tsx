"use client";

import { useState, type ReactNode } from "react";
import { Bookmark, Check, ChevronRight, Moon, Trash2 } from "lucide-react";
import { formatDuration, type Video } from "@/lib/learning";
import { momentsFor, queueOrder, type LibraryPlaylist, type Moment, type Progress, type VideoState } from "@/lib/library";

export type Selection = { playlistId: string; videoId: string; chapterStart?: number };

type Props = {
  playlists: LibraryPlaylist[];
  progress: Progress;
  selection: Selection | null;
  onOpen: (playlistId: string, videoId: string, moment?: Moment) => void;
  onToggleStatus: (videoId: string, status: "done" | "snoozed") => void;
  onRemovePlaylist: (playlist: LibraryPlaylist) => void;
  children?: ReactNode;
};

function StatusDot({ state }: { state: VideoState }) {
  if (state === "done") return <Check aria-label="Done" className="size-3.5 text-[var(--acid)]" />;
  if (state === "snoozed") return <Moon aria-label="Snoozed" className="size-3.5 text-white/45" />;
  return <span aria-label={state === "started" ? "In progress" : "Not started"} className={`block size-2.5 rounded-full border ${state === "started" ? "border-[var(--acid)] bg-[linear-gradient(90deg,var(--acid)_50%,transparent_50%)]" : "border-white/35"}`} />;
}

/** Playlists, the videos in each, and the chapters and bookmarks inside each video, as one tree of places to start. */
export function QueueSidebar({ playlists, progress, selection, onOpen, onToggleStatus, onRemovePlaylist, children }: Props) {
  const [closedPlaylists, setClosedPlaylists] = useState<Set<string>>(new Set());
  const [openVideos, setOpenVideos] = useState<Set<string>>(new Set());
  const toggle = (set: Set<string>, id: string) => { const next = new Set(set); if (!next.delete(id)) next.add(id); return next; };

  const videoRow = (playlist: LibraryPlaylist, video: Video, state: VideoState) => {
    const active = selection?.playlistId === playlist.id && selection.videoId === video.id;
    const moments = momentsFor(video, progress.videos[video.id]);
    const open = openVideos.has(`${playlist.id}:${video.id}`) || (active && moments.length > 0);
    const chapterCount = video.chapters?.length ?? 0;
    return <li key={video.id}>
      <div className={`group flex items-start gap-1 rounded-lg ${active && selection?.chapterStart === undefined ? "bg-white/[0.09]" : "hover:bg-white/[0.05]"} ${state === "done" || state === "snoozed" ? "opacity-55" : ""}`}>
        <button onClick={() => moments.length && setOpenVideos((set) => toggle(set, `${playlist.id}:${video.id}`))} aria-label={open ? "Hide chapters" : "Show chapters"} aria-expanded={open} disabled={!moments.length} className="grid h-9 w-5 shrink-0 place-items-center text-white/35 disabled:invisible">
          <ChevronRight className={`size-3.5 transition-transform ${open ? "rotate-90" : ""}`} />
        </button>
        <button onClick={() => onOpen(playlist.id, video.id)} className="flex min-w-0 flex-1 items-start gap-2 py-2 pr-1 text-left">
          <span className="grid h-4 w-3.5 shrink-0 place-items-center"><StatusDot state={state} /></span>
          <span className="min-w-0">
            <span className="line-clamp-2 text-sm leading-snug">{video.title}</span>
            <span className="mt-0.5 block truncate text-[11px] text-white/40">{[formatDuration(video.durationSeconds), chapterCount ? `${chapterCount} chapters` : "", video.channel].filter(Boolean).join(" · ")}</span>
          </span>
        </button>
        <span className={`flex shrink-0 items-center pt-1 ${active ? "" : "opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"}`}>
          <button onClick={() => onToggleStatus(video.id, "snoozed")} aria-label={state === "snoozed" ? `Unsnooze ${video.title}` : `Snooze ${video.title}`} title={state === "snoozed" ? "Unsnooze" : "Snooze"} className={`grid size-7 place-items-center rounded-md hover:bg-white/10 ${state === "snoozed" ? "text-white" : "text-white/40"}`}><Moon className="size-3.5" /></button>
          <button onClick={() => onToggleStatus(video.id, "done")} aria-label={state === "done" ? `Mark ${video.title} not done` : `Mark ${video.title} done`} title={state === "done" ? "Mark not done" : "Mark done"} className={`grid size-7 place-items-center rounded-md hover:bg-white/10 ${state === "done" ? "text-[var(--acid)]" : "text-white/40"}`}><Check className="size-3.5" /></button>
        </span>
      </div>
      {open && <ul className="mb-1 ml-7 border-l border-white/10 pl-2">{moments.map((moment) => {
        const current = active && moment.kind === "chapter" && selection?.chapterStart === moment.start;
        return <li key={moment.kind === "bookmark" ? moment.id : `c${moment.start}`}>
          <button onClick={() => onOpen(playlist.id, video.id, moment)} className={`flex w-full items-baseline gap-2 rounded-md px-2 py-1 text-left text-xs ${current ? "bg-white/[0.09] text-white" : "text-white/60 hover:bg-white/[0.05] hover:text-white"}`}>
            <span className="w-11 shrink-0 tabular-nums text-white/35">{formatDuration(moment.start) || "0:00"}</span>
            {moment.kind === "bookmark" && <Bookmark className="size-3 shrink-0 translate-y-0.5 text-[var(--acid)]" />}
            <span className={`min-w-0 flex-1 truncate ${moment.kind === "chapter" && moment.done ? "line-through decoration-white/30" : ""}`}>{moment.title || "Bookmark"}</span>
            {moment.kind === "chapter" && moment.done && <Check className="size-3 shrink-0 text-[var(--acid)]" />}
          </button>
        </li>;
      })}</ul>}
    </li>;
  };

  return <nav aria-label="Playlists" className="flex flex-col gap-3">
    {children}
    {playlists.map((playlist) => {
      const open = !closedPlaylists.has(playlist.id);
      const queue = queueOrder(playlist.videos, progress);
      const left = queue.filter((item) => item.state !== "done").length;
      return <section key={playlist.id}>
        <div className="group flex items-center gap-1">
          <button onClick={() => setClosedPlaylists((set) => toggle(set, playlist.id))} aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-1 rounded-lg py-1.5 text-left hover:bg-white/[0.05]">
            <ChevronRight className={`size-4 shrink-0 text-white/40 transition-transform ${open ? "rotate-90" : ""}`} />
            <span className="truncate text-sm font-semibold">{playlist.title}</span>
            <span className="shrink-0 text-xs text-white/35">{left}/{playlist.videos.length}</span>
          </button>
          <button onClick={() => onRemovePlaylist(playlist)} aria-label={`Remove ${playlist.title}`} title="Remove playlist" className="grid size-7 shrink-0 place-items-center rounded-md text-white/30 opacity-0 hover:bg-red-500/15 hover:text-red-300 group-focus-within:opacity-100 group-hover:opacity-100"><Trash2 className="size-3.5" /></button>
        </div>
        {open && (queue.length
          ? <ul>{queue.map(({ video, state }) => videoRow(playlist, video, state))}</ul>
          : <p className="px-6 py-2 text-xs text-white/40">No videos in this playlist.</p>)}
      </section>;
    })}
  </nav>;
}
