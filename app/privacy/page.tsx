import Link from "next/link";

export const metadata = { title: "Privacy · Jev" };

export default function PrivacyPage() {
  return <main className="min-h-screen bg-[var(--ink)] px-5 py-10 text-[var(--paper)]">
    <article className="mx-auto max-w-2xl space-y-8 leading-7 text-white/75">
      <header>
        <Link href="/" className="text-sm font-semibold text-[var(--lime)]">← Jev</Link>
        <h1 className="mt-6 font-display text-4xl text-[var(--paper)]">Privacy at Jev</h1>
        <p className="mt-2 text-sm text-white/45">Last updated September 29, 2026</p>
      </header>

      <p>Jev helps you work through YouTube playlists and share a curated feed. It uses YouTube API Services. This page explains what Jev accesses and where it goes.</p>

      <section className="space-y-2">
        <h2 className="font-display text-2xl text-[var(--paper)]">When you sign in</h2>
        <p>Google sign-in runs through Clerk. Jev uses your Google permission to read your playlists, liked videos, and video details, and to check whether you liked a video. Pressing Jev&apos;s Like control likes or unlikes that video on YouTube. Jev&apos;s Worker gets your Google access token from Clerk to make these requests; it does not send that token to your browser.</p>
      </section>

      <section className="space-y-2">
        <h2 className="font-display text-2xl text-[var(--paper)]">What stays on your device</h2>
        <p>Your playlist copies, lenses, cached question answers, and unpublished feed drafts are saved in your browser&apos;s IndexedDB. Playback position, completion, bookmarks, and speed are saved in localStorage. These copies can remain until you remove them or clear Jev&apos;s site data in your browser. Jev does not currently sync this personal workspace between devices.</p>
      </section>

      <section className="space-y-2">
        <h2 className="font-display text-2xl text-[var(--paper)]">What goes to Jev&apos;s Worker</h2>
        <p>Cloudflare runs Jev&apos;s Worker. Signed-in requests pass through it to YouTube. If you publish a feed, Jev saves its title, notes, chosen video details, lens, and any included question answers in Cloudflare KV. Anyone with the feed link can view that snapshot. The feed record also holds your Clerk user ID so only you can update or take it down. Jev does not currently save a list of the feed&apos;s viewers.</p>
        <p>If you choose to have a lens question judged, Jev sends that question and the relevant video information to Anthropic&apos;s Claude service. Jev stores a short-lived daily total of judging calls to limit use. Cloudflare and Clerk may process technical information needed to operate and secure the service. Jev does not sell your information or use third-party advertising trackers.</p>
      </section>

      <section className="space-y-2">
        <h2 className="font-display text-2xl text-[var(--paper)]">YouTube and Google</h2>
        <p>When a YouTube video plays, the embedded YouTube player communicates directly with YouTube under <a className="text-[var(--lime)] underline" href="https://policies.google.com/privacy">Google&apos;s Privacy Policy</a>. You can revoke Jev&apos;s Google access in your <a className="text-[var(--lime)] underline" href="https://myaccount.google.com/connections">Google Account connections</a>. Revoking access stops future authorized requests; it does not erase browser copies or a feed you published in Jev.</p>
      </section>

      <section className="space-y-2">
        <h2 className="font-display text-2xl text-[var(--paper)]">Removal and changes</h2>
        <p>You can delete a bookmark or draft in Jev, take down a published feed in the Studio, and clear Jev&apos;s browser data through your browser settings. For help with data Jev stores for a published feed, email <a className="text-[var(--lime)] underline" href="mailto:knowladgemoor@gmail.com">knowladgemoor@gmail.com</a>. Deleting Jev data does not delete anything from YouTube.</p>
        <p>If Jev adds server sync or changes how it uses your data, this page will be updated before the change takes effect, and Jev will ask for any consent that is needed.</p>
      </section>
      <footer className="border-t border-white/15 pt-5 text-sm"><Link className="text-[var(--lime)] underline" href="/terms">Terms</Link></footer>
    </article>
  </main>;
}
