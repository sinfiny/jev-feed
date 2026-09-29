import Link from "next/link";

export const metadata = { title: "Privacy · Jev" };

const heading = "font-display text-2xl text-[var(--paper)]";
const link = "text-[var(--lime)] underline";

/**
 * Narrow about what comes from a Google account, where Google's policies set the limits anyway, and roomy
 * about what Jev makes itself: published feeds and the counts of how they are used. Anything Jev starts
 * keeping on the server belongs in "How long Jev keeps things" before it ships.
 */
export default function PrivacyPage() {
  return <main className="min-h-screen bg-[var(--ink)] px-5 py-10 text-[var(--paper)]">
    <article className="mx-auto max-w-2xl space-y-8 leading-7 text-white/75">
      <header>
        <Link href="/" className="text-sm font-semibold text-[var(--lime)]">← Jev</Link>
        <h1 className="mt-6 font-display text-4xl text-[var(--paper)]">Privacy at Jev</h1>
        <p className="mt-2 text-sm text-white/45">Last updated September 30, 2026</p>
      </header>

      <p>Jev helps you work through YouTube playlists and share a curated feed. It uses YouTube API Services. This page explains what Jev accesses, what it keeps, and for how long.</p>

      <section className="space-y-2">
        <h2 className={heading}>When you sign in</h2>
        <p>Google sign-in runs through Clerk, which holds your name, email address, picture and the permission you gave. Jev uses that permission to read your playlists, liked videos, and video details, and to check whether you liked a video. Pressing Jev&apos;s Like control likes or unlikes that video on YouTube. Jev&apos;s Worker gets your Google access token from Clerk to make these requests; it does not send that token to your browser.</p>
        <p>Jev&apos;s use of information received from Google APIs follows the <a className={link} href="https://developers.google.com/terms/api-services-user-data-policy">Google API Services User Data Policy</a>, including the Limited Use requirements. Jev uses it to show and order your library and to build the feeds you choose to make. It is not used for advertising or to train AI models.</p>
      </section>

      <section className="space-y-2">
        <h2 className={heading}>What stays on your device</h2>
        <p>Your playlist copies, lenses, cached question answers, and unpublished feed drafts are saved in your browser&apos;s IndexedDB. Playback position, completion, bookmarks, and speed are saved in localStorage. Jev does not currently sync this personal workspace between devices.</p>
        <p>Jev reads video details from YouTube again at least every 30 days. If Jev can no longer read your YouTube account, playlist copies older than that are removed from your browser when you open Jev. Your progress and bookmarks stay.</p>
      </section>

      <section className="space-y-2">
        <h2 className={heading}>Feeds you publish</h2>
        <p>If you publish a feed, Jev saves its title, notes, chosen video details, lens, any included question answers, and your first name as its author. Anyone with the feed link can view that snapshot. The feed record also holds your Clerk user ID so only you can update or take it down.</p>
        <p>While a feed is in use, Jev reads its video details from YouTube again at least every 30 days, using the permission of the person who published it. A video that was removed from YouTube or made private leaves the feed.</p>
      </section>

      <section className="space-y-2">
        <h2 className={heading}>Counting how feeds are used</h2>
        <p>Jev is adding counts to published feeds, so the person who made a feed can see whether it is being used. When counts are on, opening or watching a published feed records that the feed was opened, which videos and chapters were played, how far each was watched and whether it was finished, the day and time, and general facts from the request such as the country and whether it was a phone or a computer.</p>
        <p>To tell a new visit from a returning one, Jev may keep a random id in the viewer&apos;s browser. It is not tied to a name, an email address or a Google account, and Jev does not keep the viewer&apos;s network address with the counts. Watching a feed never needs an account, and Jev does not ask viewers for a name or an age.</p>
        <p>The feed&apos;s organizer sees these counts, and Jev uses them to improve Jev. They are Jev&apos;s own numbers, not YouTube&apos;s. A feed sent to one person has counts that describe that one person&apos;s use.</p>
        <p>Jev may also count how its own features are used, such as that a feed was published or a lens was made, without recording which videos are in your library.</p>
      </section>

      <section className="space-y-2">
        <h2 className={heading}>Questions answered by Claude</h2>
        <p>If you choose to have a lens question judged, Jev sends that question and the relevant video information (title, channel, description, length and tags) to Anthropic&apos;s Claude service. It does not send who you are. Jev stores a short-lived daily total of judging calls to limit use.</p>
      </section>

      <section className="space-y-2">
        <h2 className={heading}>YouTube and Google</h2>
        <p>When a YouTube video plays, the embedded YouTube player communicates directly with YouTube under <a className={link} href="https://policies.google.com/privacy">Google&apos;s Privacy Policy</a>. You can revoke Jev&apos;s Google access in your <a className={link} href="https://myaccount.google.com/connections">Google Account connections</a>. Revoking access stops future authorized requests. Playlist copies in your browser are removed as they pass 30 days old. A feed you published stays until you take it down.</p>
      </section>

      <section className="space-y-2">
        <h2 className={heading}>Who helps run Jev</h2>
        <p>Cloudflare runs Jev&apos;s Worker and its storage. Clerk runs sign-in. Anthropic answers lens questions. Google and YouTube provide your playlists and the player. Each handles the technical information it needs to do its job and keep the service secure, and Clerk keeps a sign-in cookie in your browser. Jev may change who does these jobs, and this page will name them. Jev does not sell your information or use third-party advertising trackers.</p>
      </section>

      <section className="space-y-2">
        <h2 className={heading}>How long Jev keeps things</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li><b className="text-[var(--paper)]">On your device:</b> until you remove it or clear Jev&apos;s site data in your browser. Video details are read again or removed within 30 days.</li>
          <li><b className="text-[var(--paper)]">Your account:</b> until you ask for it to be deleted.</li>
          <li><b className="text-[var(--paper)]">Your playlists and likes:</b> Jev&apos;s Worker reads them for you and passes them to your browser. It keeps no copy.</li>
          <li><b className="text-[var(--paper)]">A published feed:</b> until you take it down, which deletes the snapshot.</li>
          <li><b className="text-[var(--paper)]">Feed and feature counts:</b> for as long as Jev runs, including after a feed is taken down. They carry no name, email address or Google account.</li>
          <li><b className="text-[var(--paper)]">Messages you send to Jev:</b> for as long as they help improve Jev.</li>
          <li><b className="text-[var(--paper)]">Technical records at Cloudflare and Clerk:</b> for as long as those services keep them.</li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className={heading}>Removal</h2>
        <p>You can delete a bookmark or draft in Jev, take down a published feed in the Studio, and clear Jev&apos;s browser data through your browser settings. To delete your account, a feed&apos;s counts, or anything else Jev holds about you, email <a className={link} href="mailto:knowladgemoor@gmail.com">knowladgemoor@gmail.com</a>. Jev deletes it within seven days. Deleting Jev data does not delete anything from YouTube.</p>
      </section>

      <section className="space-y-2">
        <h2 className={heading}>Changes</h2>
        <p>Jev is young and will change, and this page changes with it. The date at the top shows the latest version. If a change affects how Jev uses what it gets from your Google account, Jev asks for your agreement before the change applies to you. Other changes take effect when this page is updated.</p>
      </section>
      <footer className="border-t border-white/15 pt-5 text-sm"><Link className={link} href="/terms">Terms</Link></footer>
    </article>
  </main>;
}
