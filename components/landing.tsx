"use client";

import { useState } from "react";
import { useSignIn } from "@clerk/react";
import { Logo, Mascot } from "@/components/brand";
import { oauthErrorMessage } from "@/lib/auth";

const FEATURES = [
  { emoji: "🚪", title: "Chapters are doors", text: "Every video opens into its chapters. Start anywhere, finish one piece at a time.", tone: "var(--lime)", tilt: "-rotate-2" },
  { emoji: "🔭", title: "Lenses you write", text: "Say what matters — depth, calm, small creators, your own questions — and Jev orders everything by it.", tone: "var(--grape)", tilt: "rotate-1" },
  { emoji: "💌", title: "Feeds you send", text: "Hand-pick videos for a kid or a friend, add a note, send a link. No account needed to watch.", tone: "var(--pink)", tilt: "-rotate-1" },
];

/** The way in. Google is the only sign-in method on the Clerk instance, so a first visit signs up here too. */
export function Landing() {
  const { signIn } = useSignIn();
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(false);
  async function start() {
    setError(""); setStarting(true);
    try {
      const { error } = await signIn.sso({ strategy: "oauth_google", redirectUrl: "/", redirectCallbackUrl: "/sso-callback" });
      if (error) throw error;
    } catch (cause) {
      setError(oauthErrorMessage(cause, "Google sign-in could not start. Try again."));
      setStarting(false);
    }
  }
  return <main className="dotted min-h-screen overflow-hidden px-5 pb-16 pt-6 text-[var(--paper)]">
    <div className="mx-auto max-w-5xl">
      <Logo size={36} />
      <section className="mt-10 grid items-center gap-10 md:mt-16 md:grid-cols-[1.1fr_.9fr]">
        <div>
          <p className="inline-block -rotate-2 rounded-full bg-[var(--sun)] px-3 py-1 font-display text-sm text-[var(--ink)] shadow-[0_3px_0_#000a]">YouTube, minus the rabbit hole</p>
          <h1 className="mt-4 font-display text-[clamp(2.6rem,7vw,5rem)] leading-[.92]">Watch what you meant to watch.</h1>
          <p className="mt-4 max-w-md text-lg leading-7 text-white/60">Your playlists and likes, one chapter at a time — and feeds you design for the people you care about.</p>
          <button onClick={start} disabled={starting} className="juicy mt-7 h-14 px-6 text-lg" style={{ "--tone": "#fff" } as React.CSSProperties}>
            <svg aria-hidden viewBox="0 0 48 48" className="size-5"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z" /><path fill="#4285F4" d="M46.1 24.6c0-1.6-.1-3.1-.4-4.6H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.8c4.3-4 6.9-9.9 6.9-17.1z" /><path fill="#FBBC05" d="M10.6 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.9-6.1z" /><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.8c-2.1 1.4-4.8 2.3-8.5 2.3-6.2 0-11.5-4.1-13.4-9.9l-7.9 6.1C6.6 42.6 14.6 48 24 48z" /></svg>
            {starting ? "Opening Google…" : "Continue with Google"}
          </button>
          {error && <p role="alert" className="mt-4 text-sm text-[var(--tomato)]">{error}</p>}
          <p className="mt-4 max-w-sm text-xs leading-5 text-white/40">Jev reads your playlists and likes. Progress, bookmarks and notes stay in this browser. No ads, no autoplay, no comments.</p>
        </div>
        <div className="relative mx-auto">
          <div className="absolute -left-4 -top-6 z-10 -rotate-6 rounded-2xl rounded-bl-none border-2 border-black/70 bg-[var(--paper)] px-3 py-2 font-display text-[var(--ink)] shadow-[0_4px_0_#000a]">Hi, I&apos;m Jev!</div>
          <Mascot size={260} mood="happy" className="animate-bounce-once drop-shadow-[0_14px_0_#0008]" />
        </div>
      </section>
      <section className="mt-16 grid gap-4 md:grid-cols-3">
        {FEATURES.map((feature) => <article key={feature.title} className={`sticker-raised p-5 ${feature.tilt} transition hover:rotate-0`}>
          <span className="grid size-12 place-items-center rounded-2xl border-2 border-black/60 text-2xl" style={{ background: feature.tone }}>{feature.emoji}</span>
          <h2 className="mt-3 font-display text-xl">{feature.title}</h2>
          <p className="mt-1 text-sm leading-6 text-white/55">{feature.text}</p>
        </article>)}
      </section>
    </div>
  </main>;
}
