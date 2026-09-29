"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Copy, ExternalLink, Eye, EyeOff, GripVertical, Hand, Link2, ListPlus, LoaderCircle, MessageCircle, Pin, Plus, Rocket, Share2, Telescope, Trash2, Undo2 } from "lucide-react";
import { Hint, Mascot, burstFrom, useHints } from "@/components/brand";
import { LensEditor } from "@/components/lens-editor";
import { ReasonChips, Thumb } from "@/components/video-bits";
import type { Jev } from "@/components/use-jev";
import { formatDuration, type Video } from "@/lib/learning";
import { PRESETS, type Lens } from "@/lib/lens";
import { FEED_COLORS, FEED_EMOJI, addVideos, createDraft, editDraft, feedOrder, fingerprint, moveItem, setNote, toPublished, toggleHidden, togglePinned, type FeedDraft } from "@/lib/feed";
import { playlistIdFrom, videoIdFrom } from "@/lib/youtube-playlist";

type Props = { jev: Jev; author?: string; say: (text: string, error?: boolean) => void; openId: string | null; setOpenId: (id: string | null) => void };

const ROWS = 80;

/** Slides rows from where they were to where they are after a reorder, so a dragged dial visibly moves the list. */
function useFlip(list: React.RefObject<HTMLElement | null>, key: string) {
  const last = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    const rows = [...(list.current?.querySelectorAll<HTMLElement>("[data-flip]") ?? [])];
    const next = new Map(rows.map((row) => [row.dataset.flip!, row.getBoundingClientRect().top]));
    for (const row of rows) {
      const before = last.current.get(row.dataset.flip!);
      const delta = before === undefined ? 0 : before - next.get(row.dataset.flip!)!;
      if (!delta || Math.abs(delta) > 1500) continue;
      row.style.transition = "none";
      row.style.transform = `translateY(${delta}px)`;
      requestAnimationFrame(() => { row.style.transition = "transform .45s var(--spring)"; row.style.transform = ""; });
    }
    last.current = next;
  }, [list, key]);
}

async function publicVideos(input: string) {
  const playlistId = playlistIdFrom(input);
  if (playlistId && !videoIdFrom(input)) {
    const response = await fetch(`/api/playlist?url=${encodeURIComponent(playlistId)}`);
    const result = await response.json().catch(() => ({})) as { playlist?: { title: string }; videos?: Video[]; error?: string };
    if (!response.ok || !result.videos?.length) throw new Error(result.error || "That playlist could not be read.");
    return { title: result.playlist?.title ?? "YouTube playlist", videos: result.videos };
  }
  const ids = [...new Set(input.split(/[\s,]+/).map(videoIdFrom).filter(Boolean))];
  if (!ids.length) throw new Error("Paste a YouTube playlist link, or one or more video links.");
  const batches = Array.from({ length: Math.ceil(ids.length / 10) }, (_, index) => ids.slice(index * 10, index * 10 + 10));
  const found = (await Promise.all(batches.map((batch) => fetch(`/api/video?ids=${batch.join(",")}`).then((response) => response.json() as Promise<{ videos?: Video[] }>).catch(() => ({ videos: [] as Video[] }))))).flatMap((result) => result.videos ?? []);
  if (!found.length) throw new Error("Those videos could not be read. They may be private or removed.");
  const byId = new Map(found.map((video) => [video.id, video]));
  return { title: "", videos: ids.flatMap((id) => byId.get(id) ?? []) };
}

/**
 * The Studio: where an organizer designs a feed for someone else. Gather videos from any playlist or link,
 * order them by hand or with a lens, pin the must-watch ones, leave notes, and publish a short link.
 */
export function Studio({ jev, author, say, openId, setOpenId }: Props) {
  const { drafts, setDrafts, playlists, judgments } = jev;
  const draft = drafts.find((item) => item.id === openId) ?? null;
  const update = (change: (draft: FeedDraft) => FeedDraft) => setDrafts((all) => all.map((item) => item.id === openId ? change(item) : item));
  const create = (title: string, videos: Video[], lens: Lens | null = null) => { const made = createDraft(title, videos, lens); setDrafts((all) => [made, ...all]); setOpenId(made.id); return made; };

  if (!draft) return <StudioHome jev={jev} create={create} open={setOpenId} say={say} />;
  return <Editor key={draft.id} jev={jev} draft={draft} update={update} author={author} say={say} back={() => setOpenId(null)}
    remove={() => { if (window.confirm(draft.published ? "Delete this draft? Its published link keeps working until you take it down first." : "Delete this draft?")) { setDrafts((all) => all.filter((item) => item.id !== draft.id)); setOpenId(null); } }}
    playlists={playlists} judgments={judgments} />;
}

function StudioHome({ jev, create, open, say }: { jev: Jev; create: (title: string, videos: Video[], lens?: Lens | null) => FeedDraft; open: (id: string) => void; say: Props["say"] }) {
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  async function fromLink() {
    setBusy(true);
    try { const { title, videos } = await publicVideos(link); create(title || "New feed", videos); setLink(""); }
    catch (cause) { say(cause instanceof Error ? cause.message : "That link could not be read.", true); }
    finally { setBusy(false); }
  }
  return <div className="mx-auto max-w-4xl px-4 pb-28 pt-6 lg:px-8 lg:pt-10">
    <div className="flex items-end gap-4">
      <Mascot size={84} mood={jev.drafts.length ? "happy" : "love"} className="animate-bounce-once shrink-0" />
      <div><p className="text-xs font-bold uppercase tracking-[.2em] text-[var(--pink)]">Feed Studio</p>
        <h1 className="font-display text-[clamp(2rem,5vw,3.4rem)] leading-[.95]">Make a feed for someone you care about.</h1></div>
    </div>
    <p className="mt-3 max-w-2xl text-white/55">Pick the videos, put them in the order that makes sense — by hand, or with a lens that reads every video for you — add a note or two, and send a link. They don&apos;t need an account.</p>

    <h2 className="mt-8 font-display text-lg">Start from</h2>
    <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {jev.playlists.map((playlist) => <button key={playlist.id} onClick={() => create(playlist.title, playlist.videos)} className="sticker-raised group flex items-center gap-3 p-3 text-left transition hover:-translate-y-0.5">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--pink)]/20 text-[var(--pink)]"><ListPlus className="size-5" /></span>
        <span className="min-w-0"><span className="block truncate font-semibold">{playlist.title}</span><span className="text-xs text-white/45">{playlist.videos.length} videos from your library</span></span>
      </button>)}
      <button onClick={() => create("", [])} className="sticker flex items-center gap-3 border-dashed p-3 text-left transition hover:border-white/30">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white/10"><Plus className="size-5" /></span>
        <span><span className="block font-semibold">A blank feed</span><span className="text-xs text-white/45">Add videos as you go</span></span>
      </button>
    </div>
    <form onSubmit={(event) => { event.preventDefault(); void fromLink(); }} className="mt-3 flex gap-2">
      <label className="flex h-12 min-w-0 flex-1 items-center gap-2 rounded-2xl bg-white/[0.06] px-3.5 focus-within:ring-2 focus-within:ring-[var(--pink)]"><Link2 className="size-4 shrink-0 text-white/40" />
        <input value={link} onChange={(event) => setLink(event.target.value)} placeholder="…or paste any public playlist or video links" className="h-full min-w-0 flex-1 bg-transparent outline-none placeholder:text-white/35" /></label>
      <button disabled={busy || !link.trim()} className="juicy h-12 px-4" style={{ "--tone": "var(--pink)" } as React.CSSProperties}>{busy ? <LoaderCircle className="size-4 animate-spin" /> : "Start"}</button>
    </form>

    {!!jev.drafts.length && <>
      <h2 className="mt-10 font-display text-lg">Your feeds</h2>
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        {jev.drafts.map((item) => {
          const live = item.published && fingerprint(toPublished(item, jev.judgments)) === item.published.fingerprint;
          return <button key={item.id} onClick={() => open(item.id)} className="sticker-raised overflow-hidden text-left transition hover:-translate-y-0.5">
            <span className="flex items-center gap-3 p-4" style={{ background: `linear-gradient(135deg, color-mix(in srgb, var(--${item.color}) 35%, transparent), transparent 75%)` }}>
              <span className="text-4xl">{item.emoji}</span>
              <span className="min-w-0 flex-1"><span className="block truncate font-display text-xl">{item.title || "Untitled feed"}</span>
                <span className="text-xs text-white/55">{item.items.filter((entry) => !entry.hidden).length} videos · {item.lens ? `${item.lens.emoji} ${item.lens.name}` : "your order"}</span></span>
              <span className={`rounded-full px-2.5 py-1 text-[11px] font-black uppercase tracking-wide ${item.published ? live ? "bg-[var(--lime)] text-[var(--ink)]" : "bg-[var(--sun)] text-[var(--ink)]" : "bg-white/10 text-white/60"}`}>{item.published ? live ? "Live" : "Edited" : "Draft"}</span>
            </span>
          </button>;
        })}
      </div>
    </>}
  </div>;
}

type EditorProps = { jev: Jev; draft: FeedDraft; update: (change: (draft: FeedDraft) => FeedDraft) => void; author?: string; say: Props["say"]; back: () => void; remove: () => void; playlists: Jev["playlists"]; judgments: Jev["judgments"] };

function Editor({ jev, draft, update, author, say, back, remove, playlists, judgments }: EditorProps) {
  const [tab, setTab] = useState<"videos" | "lens">("videos");
  const [link, setLink] = useState("");
  const [adding, setAdding] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [noteOpen, setNoteOpen] = useState<string | null>(null);
  const [rows, setRows] = useState(ROWS);
  const [dragging, setDragging] = useState<string | null>(null);
  const list = useRef<HTMLOListElement>(null);
  const publishButton = useRef<HTMLButtonElement>(null);
  const hints = useHints();

  const { order, aside } = useMemo(() => feedOrder(draft.items, draft.lens, judgments), [draft.items, draft.lens, judgments]);
  const hidden = draft.items.filter((item) => item.hidden);
  const byId = new Map(draft.items.map((item) => [item.video.id, item]));
  const manual = !draft.lens;
  useFlip(list, order.map((item) => item.video.id).join());

  const payload = useMemo(() => toPublished(draft, judgments, author), [draft, judgments, author]);
  const changed = !!draft.published && fingerprint(payload) !== draft.published.fingerprint;
  const url = draft.published ? `${typeof window === "undefined" ? "" : window.location.origin}/feed/${draft.published.id}` : "";
  const totalSeconds = order.reduce((sum, item) => sum + (item.video.durationSeconds ?? 0), 0);
  const shownVideos = order.map((item) => item.video);
  const answered = draft.lens ? shownVideos.filter((video) => jev.answered(draft.lens!, video.id)).length : 0;

  // Videos pasted from public pages arrive without descriptions or counts; read them in the background so lenses have something to go on.
  const enriched = useRef(new Set<string>());
  useEffect(() => {
    const missing = draft.items.filter((item) => !item.video.complete && !enriched.current.has(item.video.id)).map((item) => item.video.id);
    if (!missing.length) return;
    missing.forEach((id) => enriched.current.add(id));
    const batches = Array.from({ length: Math.ceil(missing.length / 10) }, (_, index) => missing.slice(index * 10, index * 10 + 10));
    void (async () => {
      for (let start = 0; start < batches.length; start += 3) {
        const found = (await Promise.all(batches.slice(start, start + 3).map((batch) => fetch(`/api/video?ids=${batch.join(",")}`).then((response) => response.json() as Promise<{ videos?: Video[] }>).catch(() => ({ videos: [] as Video[] }))))).flatMap((result) => result.videos ?? []);
        if (!found.length) continue;
        const fresh = new Map(found.map((video) => [video.id, video]));
        update((current) => ({ ...current, items: current.items.map((item) => fresh.has(item.video.id) ? { ...item, video: { ...item.video, ...Object.fromEntries(Object.entries(fresh.get(item.video.id)!).filter(([, value]) => value !== undefined && value !== "")) } } : item) }));
      }
    })();
  }, [draft.items, update]);

  async function add(videos: Video[], from: string) {
    const before = draft.items.filter((item) => !item.hidden).length;
    update((current) => ({ ...current, ...addVideos(current, videos), updatedAt: Date.now() }));
    const added = new Set([...draft.items.filter((item) => !item.hidden).map((item) => item.video.id), ...videos.map((video) => video.id)]).size - before;
    say(added ? `Added ${added} video${added === 1 ? "" : "s"} from ${from}` : `Everything from ${from} is already here`);
  }

  async function addLink() {
    setAdding(true);
    try { const { title, videos } = await publicVideos(link); await add(videos, title || "your links"); setLink(""); if (!draft.title && title) update((current) => editDraft(current, { title })); }
    catch (cause) { say(cause instanceof Error ? cause.message : "That link could not be read.", true); }
    finally { setAdding(false); }
  }

  async function publish() {
    if (!payload.items.length) { say("Add at least one video first.", true); return; }
    setPublishing(true);
    try {
      const init = { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ feed: payload }) };
      const { id } = draft.published
        ? await jev.api<{ id: string }>(`/api/feeds/${draft.published.id}`, { ...init, method: "PUT" })
        : await jev.api<{ id: string }>("/api/feeds", { ...init, method: "POST" });
      update((current) => ({ ...current, published: { id, at: Date.now(), fingerprint: fingerprint(payload) } }));
      const link = `${window.location.origin}/feed/${id}`;
      await navigator.clipboard.writeText(link).catch(() => undefined);
      burstFrom(publishButton.current);
      hints.done("publish");
      say(draft.published ? "Updated! Same link, new feed." : "Published! Link copied — send it to someone.");
    } catch (cause) { say(cause instanceof Error ? cause.message : "Publishing failed. Try again.", true); }
    finally { setPublishing(false); }
  }

  async function takeDown() {
    if (!draft.published || !window.confirm("Take this feed down? The link will stop working. Your draft stays here.")) return;
    try { await jev.api(`/api/feeds/${draft.published.id}`, { method: "DELETE" }); update((current) => ({ ...current, published: undefined })); say("Taken down. The draft is still here."); }
    catch (cause) { say(cause instanceof Error ? cause.message : "Could not take it down.", true); }
  }

  const setLens = (lens: Lens | null) => update((current) => editDraft(current, { lens }));
  const lensPanel = draft.lens && <LensEditor lens={draft.lens} onChange={(lens) => { setLens(lens); hints.done("dial"); }} saved={jev.lenses}
    onSave={(lens) => { jev.setLenses((all) => [...all.filter((item) => item.id !== lens.id), lens]); setLens(lens); say(`Saved “${lens.name}”. Use it on your own playlists from the sidebar.`); }}
    onDelete={(lensId) => jev.setLenses((all) => all.filter((item) => item.id !== lensId))}
    judged={{ answered, total: shownVideos.length, running: jev.judging, onAsk: () => void jev.judge([...shownVideos, ...aside.map((item) => item.video)], draft.lens!) }} />;

  return <div className="pb-28 lg:pb-12">
    <header className="relative overflow-hidden border-b-2 border-black/50 px-4 pb-5 pt-4 lg:px-8" style={{ background: `linear-gradient(160deg, color-mix(in srgb, var(--${draft.color}) 45%, var(--ink)) 0%, var(--ink) 85%)` }}>
      <div className="flex items-center gap-2">
        <button onClick={back} className="juicy-ghost h-9 px-2.5 text-sm font-semibold">← Feeds</button>
        <span className="flex-1" />
        <div className="flex gap-1" role="radiogroup" aria-label="Feed color">{FEED_COLORS.map((color) => <button key={color} role="radio" aria-checked={draft.color === color} aria-label={color} onClick={() => update((current) => editDraft(current, { color }))}
          className={`size-6 rounded-full border-2 transition ${draft.color === color ? "scale-110 border-white" : "border-black/50 hover:scale-110"}`} style={{ background: `var(--${color})` }} />)}</div>
        <button onClick={remove} aria-label="Delete draft" title="Delete draft" className="juicy-ghost size-9 text-white/40 hover:!text-[var(--tomato)]"><Trash2 className="size-4" /></button>
      </div>
      <div className="mt-3 flex items-start gap-3">
        <button onClick={() => update((current) => editDraft(current, { emoji: FEED_EMOJI[(FEED_EMOJI.indexOf(current.emoji) + 1) % FEED_EMOJI.length] }))} title="Change the emoji" className="animate-pop grid size-16 shrink-0 place-items-center rounded-2xl border-2 border-black/60 bg-black/25 text-4xl shadow-[0_4px_0_#000a] transition active:scale-90 sm:size-20 sm:text-5xl">{draft.emoji}</button>
        <div className="min-w-0 flex-1">
          <input value={draft.title} onChange={(event) => update((current) => editDraft(current, { title: event.target.value }))} placeholder="Name this feed" aria-label="Feed title" className="w-full bg-transparent font-display text-3xl leading-tight outline-none placeholder:text-white/30 sm:text-4xl" />
          <textarea value={draft.blurb} onChange={(event) => update((current) => editDraft(current, { blurb: event.target.value.slice(0, 400) }))} rows={2} placeholder="A line for the person you're sending it to. Why these videos?" aria-label="Feed description" className="mt-1 w-full resize-none bg-transparent text-sm leading-6 text-white/75 outline-none placeholder:text-white/35" />
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button ref={publishButton} onClick={publish} disabled={publishing || !order.length || (!!draft.published && !changed)} className="juicy h-11 px-5" style={{ "--tone": "var(--pink)" } as React.CSSProperties}>
          {publishing ? <LoaderCircle className="size-4 animate-spin" /> : <Rocket className="size-4" />}{draft.published ? changed ? "Update the link" : "Up to date" : "Publish & copy link"}
        </button>
        {draft.published && <>
          <button onClick={() => navigator.clipboard.writeText(url).then(() => say("Link copied"), () => window.prompt("Copy this link", url))} className="juicy-ghost h-11 px-3 text-sm font-semibold"><Copy className="size-4" /> Copy</button>
          {typeof navigator !== "undefined" && "share" in navigator && <button onClick={() => navigator.share({ title: draft.title, url }).catch(() => undefined)} className="juicy-ghost h-11 px-3 text-sm font-semibold"><Share2 className="size-4" /> Share</button>}
          <a href={url} target="_blank" rel="noreferrer" className="juicy-ghost h-11 px-3 text-sm font-semibold"><ExternalLink className="size-4" /> Open</a>
          <button onClick={takeDown} className="juicy-ghost h-11 px-3 text-sm text-white/45 hover:!text-[var(--tomato)]">Take down</button>
        </>}
        <span className="text-xs text-white/55">{order.length} videos{totalSeconds ? ` · ${formatDuration(totalSeconds)}` : ""}{draft.published ? ` · ${url.replace(/^https?:\/\//, "")}` : ""}</span>
      </div>
      {hints.showing("publish") && !draft.published && order.length > 0 && <Hint className="mt-3 max-w-md" mood="love" onClose={() => hints.done("publish")}>When it looks right, <b>Publish</b> gives you a short link. The person you send it to needs no account, and their progress stays on their device.</Hint>}
    </header>

    <div className="mx-auto max-w-6xl px-4 pt-4 lg:px-8">
      <div className="flex flex-wrap items-center gap-2">
        <div role="radiogroup" aria-label="How this feed is ordered" className="flex rounded-2xl bg-white/[0.06] p-1">
          <button role="radio" aria-checked={manual} onClick={() => setLens(null)} className={`flex h-9 items-center gap-1.5 rounded-xl px-3 text-sm font-bold transition ${manual ? "bg-[var(--paper)] text-[var(--ink)]" : "text-white/60"}`}><Hand className="size-4" /> My order</button>
          <button role="radio" aria-checked={!manual} onClick={() => { if (manual) { setLens(structuredClone(PRESETS[0])); setTab("lens"); } }} className={`flex h-9 items-center gap-1.5 rounded-xl px-3 text-sm font-bold transition ${!manual ? "bg-[var(--grape)] text-[var(--ink)]" : "text-white/60"}`}><Telescope className="size-4" /> A lens</button>
        </div>
        {!manual && <div className="flex rounded-2xl bg-white/[0.06] p-1 lg:hidden">
          {(["videos", "lens"] as const).map((item) => <button key={item} onClick={() => setTab(item)} className={`h-9 rounded-xl px-3 text-sm font-bold capitalize ${tab === item ? "bg-white/15 text-white" : "text-white/50"}`}>{item === "lens" ? `${draft.lens!.emoji} Tune lens` : "Videos"}</button>)}
        </div>}
      </div>
      {manual && hints.showing("lens") && <Hint className="mt-3 max-w-lg" mood="think" onClose={() => hints.done("lens")}>Drag videos into your order — or switch to <b>A lens</b> and describe what matters (depth, calm, small creators, your own questions). The list re-sorts as you tune it.</Hint>}

      <div className={`mt-4 grid gap-6 ${manual ? "" : "lg:grid-cols-[minmax(0,1fr)_400px]"}`}>
        <section className={!manual && tab === "lens" ? "max-lg:hidden" : ""}>
          <div className="flex flex-col gap-2 sm:flex-row">
            <select value="" onChange={(event) => { const playlist = playlists.find((item) => item.id === event.target.value); if (playlist) void add(playlist.videos, playlist.title); }} aria-label="Add a whole playlist from your library" className="h-11 rounded-2xl bg-white/[0.06] px-3 text-sm font-semibold outline-none focus:ring-2 focus:ring-[var(--pink)]">
              <option value="">+ Add a playlist from your library</option>
              {playlists.map((playlist) => <option key={playlist.id} value={playlist.id}>{playlist.title} ({playlist.videos.length})</option>)}
            </select>
            <form onSubmit={(event) => { event.preventDefault(); void addLink(); }} className="flex min-w-0 flex-1 gap-2">
              <input value={link} onChange={(event) => setLink(event.target.value)} placeholder="Paste video or playlist links" aria-label="Video or playlist links" className="h-11 min-w-0 flex-1 rounded-2xl bg-white/[0.06] px-3.5 text-sm outline-none placeholder:text-white/35 focus:ring-2 focus:ring-[var(--pink)]" />
              <button disabled={adding || !link.trim()} className="juicy h-11 px-3.5 text-sm" style={{ "--tone": "var(--paper)" } as React.CSSProperties}>{adding ? <LoaderCircle className="size-4 animate-spin" /> : <Plus className="size-4" />}Add</button>
            </form>
          </div>

          {!order.length && !hidden.length && <div className="mt-6 flex items-center gap-4 rounded-3xl border-2 border-dashed border-white/15 p-6"><Mascot size={56} mood="wow" /><p className="text-white/60">This feed is empty. Add a playlist from your library, paste some links, or tap <b>Add to a feed</b> under any video you&apos;re watching.</p></div>}

          <ol ref={list} className="mt-4 space-y-2">
            {order.slice(0, rows).map(({ video, reasons }, index) => {
              const item = byId.get(video.id)!;
              return <li key={video.id} data-flip={video.id} draggable={manual} onDragStart={() => setDragging(video.id)} onDragEnd={() => setDragging(null)}
                onDragOver={(event) => { if (manual && dragging && dragging !== video.id) { event.preventDefault(); } }}
                onDrop={() => { if (dragging) update((current) => moveItem(current, dragging, current.items.findIndex((entry) => entry.video.id === video.id))); setDragging(null); }}
                className={`group rounded-2xl border-2 bg-[var(--ink-2)] p-2 transition-colors ${item.pinned ? "border-[var(--sun)]/50" : "border-white/[0.06]"} ${dragging === video.id ? "opacity-40" : ""}`}>
                <div className="flex items-center gap-2 sm:gap-3">
                  {manual && <GripVertical className="size-4 shrink-0 cursor-grab text-white/25 max-sm:hidden" />}
                  <span className={`w-7 shrink-0 text-center font-display text-lg ${index === 0 ? "text-[var(--lime)]" : "text-white/35"}`}>{index + 1}</span>
                  <Thumb video={video} className="w-24 shrink-0 sm:w-32" />
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-sm font-semibold leading-snug">{video.title}</p>
                    <p className="truncate text-xs text-white/45">{video.channel}{video.views !== undefined ? ` · ${Intl.NumberFormat("en", { notation: "compact" }).format(video.views)} views` : ""}</p>
                    <ReasonChips reasons={reasons} className="mt-1" />
                  </div>
                  <div className="flex shrink-0 flex-col gap-0.5 sm:flex-row">
                    {manual && <span className="flex flex-col gap-0.5 sm:hidden">
                      <button onClick={() => update((current) => moveItem(current, video.id, current.items.findIndex((entry) => entry.video.id === video.id) - 1))} aria-label="Move up" className="grid size-7 place-items-center rounded-lg text-white/45 active:bg-white/10"><ArrowUp className="size-4" /></button>
                      <button onClick={() => update((current) => moveItem(current, video.id, current.items.findIndex((entry) => entry.video.id === video.id) + 1))} aria-label="Move down" className="grid size-7 place-items-center rounded-lg text-white/45 active:bg-white/10"><ArrowDown className="size-4" /></button>
                    </span>}
                    <button onClick={() => update((current) => togglePinned(current, video.id))} aria-pressed={!!item.pinned} title={item.pinned ? "Unpin" : "Pin to the top"} className={`grid size-8 place-items-center rounded-lg transition hover:bg-white/10 ${item.pinned ? "text-[var(--sun)]" : "text-white/35"}`}><Pin className={`size-4 ${item.pinned ? "fill-current" : ""}`} /></button>
                    <button onClick={() => setNoteOpen((open) => open === video.id ? null : video.id)} title="Leave a note" className={`grid size-8 place-items-center rounded-lg transition hover:bg-white/10 ${item.note ? "text-[var(--pink)]" : "text-white/35"}`}><MessageCircle className={`size-4 ${item.note ? "fill-current" : ""}`} /></button>
                    <button onClick={() => update((current) => toggleHidden(current, video.id))} title="Leave out of this feed" className="grid size-8 place-items-center rounded-lg text-white/35 transition hover:bg-white/10 hover:text-[var(--tomato)]"><EyeOff className="size-4" /></button>
                  </div>
                </div>
                {(noteOpen === video.id || item.note) && <div className="mt-2 flex items-start gap-2 pl-9 sm:pl-12">
                  <span className="mt-2 size-2.5 shrink-0 rotate-45 bg-[var(--pink)]" />
                  <textarea autoFocus={noteOpen === video.id} value={item.note ?? ""} onChange={(event) => update((current) => setNote(current, video.id, event.target.value))} onBlur={() => setNoteOpen(null)} rows={1}
                    placeholder="Say why this one matters, or what to watch for" className="min-h-9 flex-1 resize-y rounded-xl bg-[var(--pink)]/10 px-3 py-2 text-sm text-[#ffd0e4] outline-none placeholder:text-[#ffd0e4]/40 focus:ring-2 focus:ring-[var(--pink)]" />
                </div>}
              </li>;
            })}
          </ol>
          {order.length > rows && <button onClick={() => setRows((value) => value + ROWS)} className="juicy-ghost mx-auto mt-3 flex h-10 px-4 text-sm font-bold text-[var(--pink)]">Show {Math.min(ROWS, order.length - rows)} more of {order.length - rows}</button>}

          {!!aside.length && <details className="mt-5 rounded-2xl bg-white/[0.04] p-3">
            <summary className="cursor-pointer text-sm font-semibold text-white/60">{aside.length} set aside by the lens</summary>
            <ul className="mt-2 space-y-1 text-sm text-white/50">{aside.map(({ video, why }) => <li key={video.id} className="flex gap-2"><span className="shrink-0 rounded-full bg-white/10 px-2 text-xs leading-5">{why}</span><span className="truncate">{video.title}</span></li>)}</ul>
          </details>}
          {!!hidden.length && <details className="mt-3 rounded-2xl bg-white/[0.04] p-3">
            <summary className="cursor-pointer text-sm font-semibold text-white/60">{hidden.length} left out by you</summary>
            <ul className="mt-2 space-y-1">{hidden.map((item) => <li key={item.video.id} className="flex items-center gap-2 text-sm text-white/50">
              <span className="min-w-0 flex-1 truncate">{item.video.title}</span>
              <button onClick={() => update((current) => toggleHidden(current, item.video.id))} className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs font-bold text-[var(--lime)] hover:bg-white/10"><Undo2 className="size-3.5" /> Put back</button>
            </li>)}</ul>
          </details>}
        </section>

        {!manual && <aside className={`lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto lg:rounded-3xl lg:border-2 lg:border-white/[0.07] lg:bg-[var(--ink-2)] lg:p-4 scroll-thin ${tab === "videos" ? "max-lg:hidden" : ""}`}>
          {hints.showing("dial") && <Hint className="mb-4" mood="wow" onClose={() => hints.done("dial")}>Drag a dial and watch the list re-sort. Every video shows why it moved.</Hint>}
          {lensPanel}
          {!!draft.lens?.questions.length && <p className="mt-4 text-xs text-white/35">Claude&apos;s answers are saved on this device and travel with the published feed, so viewers never wait for them.</p>}
        </aside>}
      </div>
      <p className="mt-8 flex items-center gap-1.5 text-xs text-white/35"><Eye className="size-3.5" /> Viewers see videos in exactly this order. Pinned ones always come first.</p>
    </div>
  </div>;
}
