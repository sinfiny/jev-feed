"use client";

import { FormEvent, useState } from "react";
import { LogOut, UserRound } from "lucide-react";
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

  if (!open) return <Button variant="outline" onClick={() => setOpen(true)} className="rounded-full border-white/15 bg-white/5 text-white hover:bg-white/10"><UserRound /> Sign in</Button>;

  function submit(event: FormEvent) {
    event.preventDefault();
    const message = onSignIn(name);
    if (message) { setError(message); return; }
    setName(""); setError(""); setOpen(false);
  }

  return <form onSubmit={submit} className="flex flex-col items-end gap-1">
    <div className="flex items-center gap-2 rounded-full border border-white/15 bg-white/5 p-1">
      <Input autoFocus value={name} onChange={(event) => setName(event.target.value)} aria-label="Username" placeholder="Pick a username" className="h-8 w-44 border-0 bg-transparent text-sm text-white shadow-none placeholder:text-white/30 focus-visible:ring-0" />
      <Button type="submit" size="sm" className="rounded-full bg-[var(--acid)] text-[var(--ink)] hover:bg-[var(--acid-bright)]">Continue</Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => { setOpen(false); setError(""); }} className="rounded-full text-white/50">Cancel</Button>
    </div>
    <p className="px-3 text-xs text-white/40">{error || "No password. Your name just labels your playlists in this browser."}</p>
  </form>;
}
