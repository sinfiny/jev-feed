"use client";

import { FormEvent, useState } from "react";
import { ListMusic, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MAX_PLAYLISTS, type UserPlaylist } from "@/lib/account";

type Props = {
  username: string | null;
  playlists: UserPlaylist[];
  activeId: string | null;
  onOpen: (playlist: UserPlaylist) => void;
  onCreate: (title: string) => void;
  onDelete: (playlist: UserPlaylist) => void;
};

/** The signed-in person's playlists: open one, start an empty one, or delete one. Capped at MAX_PLAYLISTS. */
export function MyPlaylists({ username, playlists, activeId, onOpen, onCreate, onDelete }: Props) {
  const [title, setTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const full = playlists.length >= MAX_PLAYLISTS;

  if (!username) return <section className="rounded-[1.5rem] border border-dashed border-white/15 p-5 text-sm text-white/45"><p className="flex items-center gap-2 text-white/70"><ListMusic className="size-4 text-[var(--acid)]" /> Your playlists</p><p className="mt-2 leading-6">Sign in with a username to build up to {MAX_PLAYLISTS} playlists of your own, one video at a time.</p></section>;

  function submit(event: FormEvent) { event.preventDefault(); onCreate(title); setTitle(""); setCreating(false); }

  return <section className="rounded-[1.5rem] border border-white/10 bg-white/[0.035] p-5">
    <div className="flex items-center justify-between gap-3">
      <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[.16em] text-white/35"><ListMusic className="size-4 text-[var(--acid)]" /> Your playlists · {playlists.length}/{MAX_PLAYLISTS}</p>
      {!creating && <Button size="sm" disabled={full} onClick={() => setCreating(true)} className="rounded-full bg-white/10 text-white hover:bg-white/20"><Plus /> New playlist</Button>}
    </div>
    {creating && <form onSubmit={submit} className="mt-3 flex gap-2"><Input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} aria-label="Playlist name" placeholder="Name it, e.g. Linear algebra" className="h-10 border-white/15 bg-black/20 text-white placeholder:text-white/30" /><Button type="submit" className="h-10 bg-[var(--acid)] text-[var(--ink)]">Create</Button><Button type="button" variant="ghost" onClick={() => setCreating(false)} className="h-10 text-white/50">Cancel</Button></form>}
    {full && <p className="mt-2 text-xs text-white/40">You own the maximum of {MAX_PLAYLISTS}. Delete one to start another.</p>}
    {playlists.length === 0 && !creating && <p className="mt-3 text-sm leading-6 text-white/45">Nothing yet. Start an empty playlist and add videos by link, or import a YouTube playlist below and save a copy.</p>}
    {playlists.length > 0 && <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">{playlists.map((playlist) => <li key={playlist.id} className={`flex items-stretch gap-1 rounded-xl border ${activeId === playlist.id ? "border-[var(--acid)] bg-[var(--acid)]/10" : "border-white/10 bg-black/10"}`}>
      <button onClick={() => onOpen(playlist)} className="min-w-0 flex-1 p-3 text-left"><span className="block truncate font-display text-lg">{playlist.title}</span><span className="text-xs text-white/45">{playlist.videos.length} video{playlist.videos.length === 1 ? "" : "s"}</span></button>
      <button onClick={() => onDelete(playlist)} aria-label={`Delete ${playlist.title}`} className="grid w-9 shrink-0 place-items-center rounded-r-xl text-white/30 hover:bg-red-500/15 hover:text-red-300"><Trash2 className="size-4" /></button>
    </li>)}</ul>}
  </section>;
}
