import Link from "next/link";

export const metadata = { title: "Terms · Jev" };

export default function TermsPage() {
  return <main className="min-h-screen bg-[var(--ink)] px-5 py-10 text-[var(--paper)]">
    <article className="mx-auto max-w-2xl space-y-8 leading-7 text-white/75">
      <header>
        <Link href="/" className="text-sm font-semibold text-[var(--lime)]">← Jev</Link>
        <h1 className="mt-6 font-display text-4xl text-[var(--paper)]">Jev terms</h1>
        <p className="mt-2 text-sm text-white/45">Last updated September 29, 2026</p>
      </header>
      <p>Jev is a free tool for watching YouTube playlists and sharing feeds. By using Jev, you agree to the <a className="text-[var(--lime)] underline" href="https://www.youtube.com/t/terms">YouTube Terms of Service</a>.</p>
      <section className="space-y-2">
        <h2 className="font-display text-2xl text-[var(--paper)]">Feeds you publish</h2>
        <p>You choose the videos and notes in a feed. Anyone with its link can view it. Please share only material you have the right to share and avoid putting private information in public notes. You can update or take down your feed in Jev&apos;s Studio.</p>
      </section>
      <section className="space-y-2">
        <h2 className="font-display text-2xl text-[var(--paper)]">Availability</h2>
        <p>Jev depends on YouTube and other services, so videos and features may become unavailable. Jev is provided as available and may change while it is being developed.</p>
      </section>
      <p>Questions about these terms can go to <a className="text-[var(--lime)] underline" href="mailto:knowladgemoor@gmail.com">knowladgemoor@gmail.com</a>.</p>
      <footer className="border-t border-white/15 pt-5 text-sm"><Link className="text-[var(--lime)] underline" href="/privacy">Privacy</Link></footer>
    </article>
  </main>;
}
