"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import type { VideoState } from "@/lib/library";

export type Mood = "calm" | "happy" | "wow" | "sleepy" | "wink" | "love" | "think" | "sad";

const INK = "#12110f";

/**
 * Jev, the mascot: a lime bean with a play button for an antenna. It reacts to what the viewer does
 * (done → happy, snooze → sleepy, publish → love, loading → think, trouble → sad) and otherwise sits still.
 */
export function Mascot({ mood = "calm", size = 48, look = [0, 0], className = "", title }: { mood?: Mood; size?: number; look?: [number, number]; className?: string; title?: string }) {
  const [dx, dy] = mood === "think" ? [2.2, -2.6] : mood === "sad" ? [0, 2] : look;
  const openEye = (cx: number) => <g key={cx}>
    <ellipse cx={cx} cy={55} rx={8.2} ry={9.6} fill="#fff" stroke={INK} strokeWidth={3} />
    <circle cx={cx + dx} cy={56 + dy} r={mood === "wow" ? 5.2 : 4.3} fill={INK} />
    <circle cx={cx + dx + 1.6} cy={54 + dy} r={1.4} fill="#fff" />
  </g>;
  const closedEye = (cx: number) => <path key={cx} d={`M${cx - 7} 55 Q${cx} ${mood === "sleepy" ? 61 : 49} ${cx + 7} 55`} fill="none" stroke={INK} strokeWidth={3.5} strokeLinecap="round" />;
  const heartEye = (cx: number) => <path key={cx} d={`M${cx} 62 C${cx - 11} 54 ${cx - 7} 45 ${cx} 51 C${cx + 7} 45 ${cx + 11} 54 ${cx} 62 Z`} fill="var(--pink)" stroke={INK} strokeWidth={2.5} strokeLinejoin="round" />;
  const eyes = mood === "sleepy" ? [closedEye(38), closedEye(62)]
    : mood === "wink" ? [closedEye(38), openEye(62)]
      : mood === "love" ? [heartEye(38), heartEye(62)]
        : mood === "happy" ? [closedEye(38), closedEye(62)] : [openEye(38), openEye(62)];
  const mouth = {
    calm: <path d="M44 70 Q50 75 56 70" fill="none" stroke={INK} strokeWidth={3.5} strokeLinecap="round" />,
    happy: <g><path d="M41 67 Q50 81 59 67 Z" fill={INK} stroke={INK} strokeWidth={2} strokeLinejoin="round" /><path d="M46 73 Q50 77 54 73 Q50 71 46 73" fill="var(--pink)" /></g>,
    wink: <path d="M42 68 Q50 78 58 68" fill="none" stroke={INK} strokeWidth={3.5} strokeLinecap="round" />,
    love: <path d="M42 68 Q50 78 58 68" fill="none" stroke={INK} strokeWidth={3.5} strokeLinecap="round" />,
    wow: <ellipse cx={50} cy={72} rx={4.2} ry={5.2} fill={INK} />,
    sleepy: <path d="M46 71 Q50 73 54 71" fill="none" stroke={INK} strokeWidth={3} strokeLinecap="round" />,
    think: <path d="M45 71 L55 70" fill="none" stroke={INK} strokeWidth={3.5} strokeLinecap="round" />,
    sad: <path d="M44 73 Q50 67 56 73" fill="none" stroke={INK} strokeWidth={3.5} strokeLinecap="round" />,
  }[mood];
  return <svg viewBox="0 0 100 100" width={size} height={size} className={className} role="img" aria-label={title ?? "Jev"}>
    <path d="M50 22 C50 16 52 12 55 9" fill="none" stroke={INK} strokeWidth={7} strokeLinecap="round" />
    <path d="M50 22 C50 16 52 12 55 9" fill="none" stroke="var(--lime)" strokeWidth={3} strokeLinecap="round" />
    <path d="M53 3.5 L63 9.2 L53 14.8 Z" fill="var(--pink)" stroke={INK} strokeWidth={3} strokeLinejoin="round" />
    <ellipse cx={39} cy={91} rx={7} ry={4} fill={INK} />
    <ellipse cx={61} cy={91} rx={7} ry={4} fill={INK} />
    <path d="M50 20 C75 20 89 35 89 57 C89 79 72 90 50 90 C28 90 11 79 11 57 C11 35 25 20 50 20 Z" fill="var(--lime)" stroke={INK} strokeWidth={4.5} />
    <ellipse cx={31} cy={35} rx={8} ry={4.2} fill="#fff" opacity={0.55} transform="rotate(-32 31 35)" />
    <ellipse cx={26} cy={67} rx={5} ry={3} fill="var(--pink)" opacity={0.75} />
    <ellipse cx={74} cy={67} rx={5} ry={3} fill="var(--pink)" opacity={0.75} />
    {eyes}
    {mouth}
    {mood === "sleepy" && <text x={78} y={26} fontFamily="var(--font-display)" fontWeight={800} fontSize={16} fill="var(--sky)" stroke={INK} strokeWidth={1}>z</text>}
    {mood === "think" && <g fill="var(--sun)" stroke={INK} strokeWidth={1.5}><circle cx={84} cy={30} r={3} /><circle cx={91} cy={20} r={4.5} /></g>}
  </svg>;
}

/** The wordmark: Jev next to its lowercase name. */
export function Logo({ size = 32, mood = "calm", className = "" }: { size?: number; mood?: Mood; className?: string }) {
  return <span className={`inline-flex items-center gap-1.5 ${className}`}>
    <Mascot size={size} mood={mood} title="Jev" />
    <span className="font-display leading-none" style={{ fontSize: size * 0.72, fontWeight: 800, letterSpacing: "-0.06em" }}>jev</span>
  </span>;
}

/** Where a video stands, drawn as one glyph: an empty ring, a pie of how far in, a moon, or a check. */
export function StatusGlyph({ state, fraction = 0.5, size = 16 }: { state: VideoState; fraction?: number; size?: number }) {
  const label = { new: "Not started", started: "In progress", snoozed: "Snoozed", done: "Done" }[state];
  if (state === "done") return <svg viewBox="0 0 16 16" width={size} height={size} role="img" aria-label={label}><circle cx={8} cy={8} r={7.5} fill="var(--lime)" /><path d="M4.6 8.3 L7 10.6 L11.4 5.7" fill="none" stroke={INK} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" /></svg>;
  if (state === "snoozed") return <svg viewBox="0 0 16 16" width={size} height={size} role="img" aria-label={label}><circle cx={8} cy={8} r={7.5} fill="#58c7ff26" /><path d="M10.8 10.9 A4.4 4.4 0 1 1 7.2 3.6 A3.4 3.4 0 0 0 10.8 10.9 Z" fill="var(--sky)" /></svg>;
  const angle = Math.min(0.999, Math.max(0.08, fraction)) * Math.PI * 2;
  const x = 8 + 5.5 * Math.sin(angle), y = 8 - 5.5 * Math.cos(angle);
  return <svg viewBox="0 0 16 16" width={size} height={size} role="img" aria-label={label}>
    <circle cx={8} cy={8} r={6.8} fill="none" stroke={state === "started" ? "var(--sun)" : "#ffffff4d"} strokeWidth={1.6} />
    {state === "started" && <path d={`M8 8 L8 2.5 A5.5 5.5 0 ${angle > Math.PI ? 1 : 0} 1 ${x.toFixed(2)} ${y.toFixed(2)} Z`} fill="var(--sun)" />}
  </svg>;
}

const CONFETTI = ["var(--lime)", "var(--pink)", "var(--sky)", "var(--sun)", "var(--grape)"];

/** A one-off burst of confetti from a point, for done and publish. Removed after it falls; skipped under reduced motion by CSS. */
export function burst(x: number, y: number, count = 22) {
  if (typeof document === "undefined") return;
  for (let index = 0; index < count; index += 1) {
    const bit = document.createElement("span");
    const angle = (Math.PI * 2 * index) / count + Math.random() * 0.4;
    const distance = 60 + Math.random() * 90;
    bit.className = "confetti-bit";
    bit.style.left = `${x}px`;
    bit.style.top = `${y}px`;
    bit.style.background = CONFETTI[index % CONFETTI.length];
    bit.style.setProperty("--dx", `${Math.cos(angle) * distance}px`);
    bit.style.setProperty("--dy", `${Math.sin(angle) * distance + 70}px`);
    bit.style.setProperty("--spin", `${Math.random() * 720 - 360}deg`);
    document.body.appendChild(bit);
    setTimeout(() => bit.remove(), 1000);
  }
}
export const burstFrom = (element: Element | null) => { const box = element?.getBoundingClientRect(); if (box) burst(box.left + box.width / 2, box.top + box.height / 2); };

const HINTS_KEY = "jev-hints-v1";

/**
 * Teaching without a tutorial: each hint is shown in context until the viewer does the thing it describes
 * (or waves it away), then never again.
 */
export function useHints() {
  const [seen, setSeen] = useState<Set<string> | null>(null);
  useEffect(() => {
    let stored: string[] = [];
    try { stored = JSON.parse(localStorage.getItem(HINTS_KEY) ?? "[]") as string[]; } catch { /* Start fresh. */ }
    queueMicrotask(() => setSeen(new Set(Array.isArray(stored) ? stored : [])));
  }, []);
  const done = useCallback((id: string) => setSeen((current) => {
    if (!current || current.has(id)) return current;
    const next = new Set(current).add(id);
    localStorage.setItem(HINTS_KEY, JSON.stringify([...next]));
    return next;
  }), []);
  const showing = useCallback((id: string) => !!seen && !seen.has(id), [seen]);
  return { showing, done };
}

export function Hint({ children, onClose, mood = "wink", className = "" }: { children: ReactNode; onClose: () => void; mood?: Mood; className?: string }) {
  return <div role="note" className={`animate-rise flex items-start gap-2.5 rounded-2xl border-2 border-black/60 bg-[var(--paper)] p-2.5 pr-2 text-sm leading-snug text-[var(--ink)] shadow-[0_4px_0_#000a] ${className}`}>
    <Mascot size={30} mood={mood} className="-mt-0.5 shrink-0" />
    <div className="min-w-0 flex-1 pt-0.5">{children}</div>
    <button onClick={onClose} aria-label="Got it" className="grid size-6 shrink-0 place-items-center rounded-full text-black/50 hover:bg-black/10 hover:text-black"><X className="size-3.5" /></button>
  </div>;
}

/** The feed color as CSS custom property values. */
export const toneOf = (color: string) => `var(--${color})`;
