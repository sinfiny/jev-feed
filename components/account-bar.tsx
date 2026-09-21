"use client";

import { FormEvent, useState } from "react";
import { LogOut, UserRound, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Username-only sign in. No password: the name is just a label the browser remembers so a
 * person can own playlists. Prototype shape, not authentication.
 */
export function AccountBar({ username, onSignIn, onSignOut }: { username: string | null; onSignIn: (name: string) => string; onSignOut: () => void }) {
  const [name, setName] = useState("");
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");

  if (username) {
    return <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 py-1 pl-3 pr-1 text-sm text-white/70">
      <UserRound className="size-4 text-[var(--acid)]" /> {username}
      <Button size="icon-sm" variant="ghost" onClick={onSignOut} aria-label="Sign out" className="rounded-full text-white/50 hover:text-white"><LogOut className="size-4" /></Button>
    </div>;
  }

  if (!open) return <Button variant="outline" onClick={() => setOpen(true)} className="rounded-full border-white/15 bg-white/5 text-white hover:bg-white/10"><UserRound /> <span className="hidden sm:inline">Save playlists</span><span className="sm:hidden">Save</span></Button>;

  function submit(event: FormEvent) {
    event.preventDefault();
    const message = onSignIn(name);
    if (message) { setError(message); return; }
    setName(""); setError(""); setOpen(false);
  }

  return <div className="fixed inset-0 z-50 grid place-items-end bg-black/70 p-3 sm:place-items-center" role="presentation" onMouseDown={() => { setOpen(false); setError(""); }}>
    <form onSubmit={submit} onMouseDown={(event) => event.stopPropagation()} className="w-full max-w-md rounded-[1.5rem] border border-white/15 bg-[#1a1b17] p-5 shadow-2xl">
      <div className="flex items-start justify-between gap-4"><div><h2 className="font-display text-2xl">Save playlists on this device</h2><p className="mt-2 text-sm leading-6 text-white/50">Choose a name to organize your playlists. There is no account or password.</p></div><Button type="button" size="icon" variant="ghost" onClick={() => { setOpen(false); setError(""); }} aria-label="Close"><X /></Button></div>
      <label className="mt-5 block text-xs font-semibold uppercase tracking-[.14em] text-white/45" htmlFor="local-name">Your name</label>
      <Input id="local-name" autoFocus value={name} onChange={(event) => setName(event.target.value)} aria-label="Your name" placeholder="Letters, numbers, dots or dashes" className="mt-2 h-12 border-white/15 bg-black/20 text-base text-white placeholder:text-white/30" />
      {error && <p className="mt-2 text-sm text-red-300">{error}</p>}
      <Button type="submit" className="mt-4 h-12 w-full rounded-xl bg-[var(--acid)] text-[var(--ink)] hover:bg-[var(--acid-bright)]">Save on this device</Button>
    </form>
  </div>;
}
