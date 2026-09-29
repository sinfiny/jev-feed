"use client";

import { CalendarDays, Eye, Heart, ThumbsUp, Timer, Users } from "lucide-react";
import { formatCount, formatDuration, type Video } from "@/lib/learning";
import { DIALS, DIAL_KEYS, type Lens, type Reason } from "@/lib/lens";

/** "3 weeks ago" from a date YouTube gave in any of its formats. Empty when it cannot be read. */
export function age(published?: string, now = Date.now()) {
  const at = published ? Date.parse(published) : NaN;
  if (!Number.isFinite(at)) return published && /ago$/.test(published) ? published : "";
  const days = Math.max(0, (now - at) / 86_400_000);
  const [value, unit] = days < 1 ? [0, "today"] : days < 14 ? [Math.floor(days), "day"] : days < 60 ? [Math.floor(days / 7), "week"] : days < 730 ? [Math.floor(days / 30), "month"] : [Math.floor(days / 365), "year"];
  return unit === "today" ? "today" : `${value} ${unit}${value === 1 ? "" : "s"} ago`;
}

export function Thumb({ video, className = "", children }: { video: Video; className?: string; children?: React.ReactNode }) {
  return <span className={`relative block aspect-video overflow-hidden rounded-xl bg-white/[0.06] ${className}`}>
    {/* eslint-disable-next-line @next/next/no-img-element -- YouTube thumbnails, already sized by YouTube. */}
    <img src={video.thumbnail || `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`} alt="" loading="lazy" className="size-full object-cover" />
    {video.durationSeconds ? <span className="absolute bottom-1 right-1 rounded-md bg-black/80 px-1 py-0.5 text-[10px] font-bold tabular-nums text-white">{formatDuration(video.durationSeconds)}</span> : null}
    {children}
  </span>;
}

export function ChannelAvatar({ video, size = 28 }: { video: Video; size?: number }) {
  return video.channelAvatar
    // eslint-disable-next-line @next/next/no-img-element -- A channel avatar from YouTube.
    ? <img src={video.channelAvatar} alt="" width={size} height={size} className="shrink-0 rounded-full border-2 border-black/60 bg-white/10" />
    : <span className="grid shrink-0 place-items-center rounded-full border-2 border-black/60 bg-[var(--grape)] font-display text-xs text-[var(--ink)]" style={{ width: size, height: size }}>{video.channel.slice(0, 1).toUpperCase()}</span>;
}

/** The numbers YouTube shows about a video, as small chips. Missing numbers are simply left out. */
export function StatChips({ video, className = "" }: { video: Video; className?: string }) {
  const ratio = video.likes !== undefined && video.views ? (video.likes / video.views) * 100 : undefined;
  const chips = [
    video.views !== undefined && { icon: <Eye className="size-3.5" />, text: `${formatCount(video.views)} views`, tone: "" },
    video.likes !== undefined && { icon: <ThumbsUp className="size-3.5" />, text: formatCount(video.likes), tone: "" },
    ratio !== undefined && { icon: <Heart className="size-3.5" />, text: `${ratio < 1 ? ratio.toFixed(1) : Math.round(ratio)}% liked`, tone: ratio >= 4 ? "text-[var(--pink)]" : "", title: "Likes per hundred views. Above 4% is a crowd favorite." },
    video.subscribers !== undefined && { icon: <Users className="size-3.5" />, text: `${formatCount(video.subscribers)} subs`, tone: "" },
    video.durationSeconds && { icon: <Timer className="size-3.5" />, text: formatDuration(video.durationSeconds), tone: "" },
    age(video.published) && { icon: <CalendarDays className="size-3.5" />, text: age(video.published), tone: "" },
  ].filter((chip): chip is { icon: React.ReactElement; text: string; tone: string; title?: string } => !!chip);
  return <div className={`flex flex-wrap gap-1.5 ${className}`}>
    {chips.map((chip) => <span key={chip.text} title={chip.title} className={`inline-flex items-center gap-1 rounded-full bg-white/[0.07] px-2.5 py-1 text-xs font-semibold text-white/70 ${chip.tone}`}>{chip.icon}{chip.text}</span>)}
  </div>;
}

/** Why a lens put a video where it is. */
export function ReasonChips({ reasons, className = "" }: { reasons: Reason[]; className?: string }) {
  if (!reasons.length) return null;
  return <div className={`flex flex-wrap gap-1 ${className}`}>
    {reasons.map((reason) => <span key={reason.label} className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${reason.tone === "good" ? "bg-[var(--grape)]/20 text-[#c9b8ff]" : "bg-[var(--tomato)]/15 text-[#ff9d95]"}`}>{reason.tone === "good" ? "↑" : "↓"} {reason.label}</span>)}
  </div>;
}

/** A read-only summary of a lens: its name and a bar per judge, seek to the right, avoid to the left. */
export function LensSummary({ lens, compact = false }: { lens: Lens; compact?: boolean }) {
  const dials = DIAL_KEYS.filter((dial) => lens.dials[dial]);
  const rows = [
    ...dials.map((dial) => ({ label: DIALS[dial].label, weight: lens.dials[dial]! })),
    ...lens.questions.filter((question) => question.weight).map((question) => ({ label: question.text, weight: question.weight })),
  ];
  return <div>
    <p className="flex items-center gap-2 font-display text-lg"><span className="text-2xl">{lens.emoji}</span>{lens.name}</p>
    {!compact && <ul className="mt-2 space-y-1.5">
      {rows.map((row) => <li key={row.label} className="grid grid-cols-[minmax(0,1fr)_88px] items-center gap-3 text-xs text-white/70">
        <span className="truncate">{row.label}</span>
        <span className="relative h-2 rounded-full bg-white/10"><span className="absolute top-0 h-2 w-px bg-white/40 left-1/2" />
          <span className={`absolute top-0 h-2 rounded-full ${row.weight > 0 ? "left-1/2 bg-[var(--grape)]" : "right-1/2 bg-[var(--tomato)]"}`} style={{ width: `${Math.abs(row.weight) * 25}%` }} /></span>
      </li>)}
      {!!lens.boost.length && <li className="text-xs text-white/60">Lifts: {lens.boost.join(", ")}</li>}
      {!!lens.bury.length && <li className="text-xs text-white/60">Sinks: {lens.bury.join(", ")}</li>}
      {(lens.hideShorts || lens.maxMinutes) && <li className="text-xs text-white/60">Leaves out {[lens.hideShorts && "shorts", lens.maxMinutes && `videos over ${lens.maxMinutes} min`].filter(Boolean).join(" and ")}</li>}
    </ul>}
  </div>;
}
