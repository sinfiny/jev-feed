"use client";

import { useState } from "react";
import { Bot, Plus, Save, Sparkles, Trash2, X } from "lucide-react";
import { Mascot } from "@/components/brand";
import { DIALS, DIAL_KEYS, PRESETS, type Dial, type Lens, type Weight } from "@/lib/lens";

type Props = {
  lens: Lens;
  onChange: (lens: Lens) => void;
  /** The viewer's saved lenses, offered next to the presets. */
  saved: Lens[];
  onSave?: (lens: Lens) => void;
  onDelete?: (lensId: string) => void;
  /** How many of the videos Claude has answered every question for, and a way to ask about the rest. */
  judged?: { answered: number; total: number; running: { done: number; total: number } | null; onAsk: () => void };
};

const WORD = { "-2": "Avoid", "-1": "Less", "0": "Don't care", "1": "More", "2": "Love" } as const;
const tone = (weight: number) => weight > 0 ? "var(--grape)" : weight < 0 ? "var(--tomato)" : "#ffffff40";

/** A five-step slider from avoid to seek. The track fills from the middle toward the thumb. */
function WeightSlider({ value, onChange, label }: { value: Weight; onChange: (value: Weight) => void; label: string }) {
  const left = value < 0 ? 50 + value * 25 : 50;
  const right = value > 0 ? 50 + value * 25 : 50;
  return <input type="range" min={-2} max={2} step={1} value={value} aria-label={label} aria-valuetext={WORD[String(value) as keyof typeof WORD]}
    onChange={(event) => onChange(Number(event.target.value) as Weight)} className="dial"
    style={{ "--thumb": value ? tone(value) : "var(--paper)", "--track": `linear-gradient(90deg, #ffffff14 ${left}%, ${tone(value)} ${left}%, ${tone(value)} ${right}%, #ffffff14 ${right}%)` } as React.CSSProperties} />;
}

function Words({ label, words, onChange, color }: { label: string; words: string[]; onChange: (words: string[]) => void; color: string }) {
  const [draft, setDraft] = useState("");
  const add = () => { const word = draft.trim(); if (word && !words.includes(word)) onChange([...words, word].slice(0, 20)); setDraft(""); };
  return <div>
    <p className="mb-1.5 text-xs font-bold uppercase tracking-wider text-white/45">{label}</p>
    <div className="flex flex-wrap items-center gap-1.5 rounded-2xl bg-white/[0.05] p-1.5">
      {words.map((word) => <span key={word} className="animate-pop inline-flex items-center gap-1 rounded-full py-1 pl-2.5 pr-1 text-xs font-bold text-[var(--ink)]" style={{ background: color }}>
        {word}<button onClick={() => onChange(words.filter((item) => item !== word))} aria-label={`Remove ${word}`} className="grid size-4 place-items-center rounded-full hover:bg-black/15"><X className="size-3" /></button></span>)}
      <input value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === ",") { event.preventDefault(); add(); } }} onBlur={add}
        placeholder={words.length ? "Add another" : "Type a word, press Enter"} className="h-7 min-w-28 flex-1 bg-transparent px-1.5 text-sm outline-none placeholder:text-white/30" />
    </div>
  </div>;
}

/**
 * Where a viewer writes their own schema for judging videos. Every change re-ranks at once, so the list
 * beside it moves while a dial is dragged — the editor teaches itself.
 */
export function LensEditor({ lens, onChange, saved, onSave, onDelete, judged }: Props) {
  const [allDials, setAllDials] = useState(false);
  const set = (change: Partial<Lens>) => onChange({ ...lens, ...change });
  const setDial = (dial: Dial, weight: Weight) => set({ dials: { ...lens.dials, [dial]: weight || undefined } });
  const active = DIAL_KEYS.filter((dial) => lens.dials[dial]);
  const visible = allDials ? DIAL_KEYS : [...active, ...DIAL_KEYS.filter((dial) => !lens.dials[dial])].slice(0, Math.max(5, active.length));
  const isSaved = saved.some((item) => item.id === lens.id);

  return <div className="space-y-6">
    <div>
      <p className="mb-2 text-xs font-bold uppercase tracking-wider text-white/45">Start from</p>
      <div className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
        {[...PRESETS, ...saved].map((item) => <button key={item.id} onClick={() => onChange(structuredClone(item))}
          className={`flex shrink-0 items-center gap-1.5 rounded-full border-2 px-3 py-1.5 text-sm font-semibold transition ${item.id === lens.id ? "border-[var(--grape)] bg-[var(--grape)]/20 text-white" : "border-white/10 text-white/65 hover:border-white/25 hover:text-white"}`}>
          <span>{item.emoji}</span>{item.name}</button>)}
      </div>
    </div>

    <div className="flex items-center gap-2">
      <input value={lens.emoji} onChange={(event) => set({ emoji: [...event.target.value].slice(-1).join("") || "🔭" })} aria-label="Lens emoji" className="size-11 rounded-xl bg-white/[0.06] text-center text-xl outline-none focus:ring-2 focus:ring-[var(--grape)]" />
      <input value={lens.name} onChange={(event) => set({ name: event.target.value.slice(0, 40) })} aria-label="Lens name" className="h-11 min-w-0 flex-1 rounded-xl bg-white/[0.06] px-3 font-display text-lg outline-none focus:ring-2 focus:ring-[var(--grape)]" />
      {onSave && <button onClick={() => onSave(isSaved ? lens : { ...lens, id: `lens_${Date.now().toString(36)}` })} title="Keep this lens to reuse on your own playlists" className="juicy h-11 px-3 text-sm" style={{ "--tone": "var(--grape)" } as React.CSSProperties}><Save className="size-4" /><span className="max-sm:hidden">{isSaved ? "Update" : "Save lens"}</span></button>}
      {onDelete && isSaved && <button onClick={() => onDelete(lens.id)} aria-label="Delete this saved lens" className="juicy-ghost size-11 text-white/40 hover:!text-[var(--tomato)]"><Trash2 className="size-4" /></button>}
    </div>

    <section>
      <div className="mb-1 flex items-baseline justify-between"><p className="text-xs font-bold uppercase tracking-wider text-white/45">Dials · what Jev reads from each video</p>
        <button onClick={() => setAllDials((value) => !value)} className="text-xs font-bold text-[var(--grape)] hover:underline">{allDials ? "Fewer" : `All ${DIAL_KEYS.length} dials`}</button></div>
      <ul className="grid gap-x-6 gap-y-1 xl:grid-cols-2">
        {visible.map((dial) => {
          const weight = lens.dials[dial] ?? 0;
          return <li key={dial} className="rounded-2xl px-1 py-1.5">
            <div className="flex items-baseline justify-between gap-2 text-sm"><span className="font-semibold" title={DIALS[dial].hint}>{DIALS[dial].label}</span>
              <span className="text-xs font-bold" style={{ color: weight ? tone(weight) : "#ffffff55" }}>{weight ? `${WORD[String(weight) as keyof typeof WORD]}: ${weight > 0 ? DIALS[dial].seek : DIALS[dial].avoid}` : DIALS[dial].hint}</span></div>
            <WeightSlider value={weight} onChange={(value) => setDial(dial, value)} label={`${DIALS[dial].label}: from ${DIALS[dial].avoid} to ${DIALS[dial].seek}`} />
            <div className="-mt-1 flex justify-between text-[10px] font-semibold uppercase tracking-wide text-white/30"><span>{DIALS[dial].avoid}</span><span>{DIALS[dial].seek}</span></div>
          </li>;
        })}
      </ul>
    </section>

    <section className="grid gap-4 sm:grid-cols-2">
      <Words label="Lift videos that mention" words={lens.boost} onChange={(boost) => set({ boost })} color="var(--grape)" />
      <Words label="Sink videos that mention" words={lens.bury} onChange={(bury) => set({ bury })} color="var(--tomato)" />
    </section>

    <section className="rounded-3xl border-2 border-[var(--grape)]/40 bg-[var(--grape)]/[0.07] p-3.5">
      <div className="flex items-start gap-2.5"><Bot className="mt-0.5 size-5 shrink-0 text-[var(--grape)]" /><div>
        <p className="font-display text-base">Ask Claude about each video</p>
        <p className="text-xs leading-5 text-white/55">Write questions in your own words. Claude reads each video&apos;s title and description once, scores it 0–10, and Jev remembers the answer.</p></div></div>
      <ul className="mt-3 space-y-2">
        {lens.questions.map((question, index) => <li key={question.id} className="animate-rise rounded-2xl bg-black/20 p-2">
          <div className="flex items-center gap-1.5">
            <input value={question.text} onChange={(event) => set({ questions: lens.questions.map((item, position) => position === index ? { ...item, text: event.target.value.slice(0, 160) } : item) })}
              placeholder="Does it show real code on screen?" aria-label={`Question ${index + 1}`} className="h-9 min-w-0 flex-1 bg-transparent px-1.5 text-sm outline-none placeholder:text-white/30" />
            <button onClick={() => set({ questions: lens.questions.filter((_, position) => position !== index) })} aria-label="Remove question" className="grid size-8 place-items-center rounded-full text-white/35 hover:bg-white/10 hover:text-white"><X className="size-4" /></button>
          </div>
          <div className="px-1"><WeightSlider value={question.weight} onChange={(weight) => set({ questions: lens.questions.map((item, position) => position === index ? { ...item, weight } : item) })} label={`How much a yes to question ${index + 1} matters`} />
            <div className="-mt-1 flex justify-between text-[10px] font-semibold uppercase tracking-wide text-white/30"><span>Prefer no</span><span>Prefer yes</span></div></div>
        </li>)}
      </ul>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {lens.questions.length < 5 && <button onClick={() => set({ questions: [...lens.questions, { id: `q_${Date.now().toString(36)}`, text: "", weight: 2 }] })} className="juicy-ghost h-9 px-3 text-sm font-semibold text-[#cbbaff]"><Plus className="size-4" /> Add a question</button>}
        {judged && lens.questions.some((question) => question.text.trim() && question.weight) && (judged.running
          ? <span className="flex items-center gap-2 text-sm text-white/70"><Mascot size={26} mood="think" /> Claude is reading… {judged.running.done}/{judged.running.total}</span>
          : judged.answered < judged.total
            ? <button onClick={judged.onAsk} className="juicy h-9 px-3 text-sm" style={{ "--tone": "var(--grape)" } as React.CSSProperties}><Sparkles className="size-4" /> Ask Claude about {judged.total - judged.answered} video{judged.total - judged.answered === 1 ? "" : "s"}</button>
            : <span className="text-sm font-semibold text-[#cbbaff]">✓ Claude has answered for all {judged.total}</span>)}
      </div>
    </section>

    <section className="flex flex-wrap items-center gap-2">
      <p className="w-full text-xs font-bold uppercase tracking-wider text-white/45">Leave out</p>
      <button onClick={() => set({ hideShorts: !lens.hideShorts || undefined })} aria-pressed={!!lens.hideShorts} className={`rounded-full border-2 px-3 py-1.5 text-sm font-semibold ${lens.hideShorts ? "border-[var(--tomato)] bg-[var(--tomato)]/15 text-[#ffb1aa]" : "border-white/10 text-white/60"}`}>Shorts</button>
      {[10, 20, 30, 60, 90].map((minutes) => <button key={minutes} onClick={() => set({ maxMinutes: lens.maxMinutes === minutes ? undefined : minutes })} aria-pressed={lens.maxMinutes === minutes}
        className={`rounded-full border-2 px-3 py-1.5 text-sm font-semibold ${lens.maxMinutes === minutes ? "border-[var(--tomato)] bg-[var(--tomato)]/15 text-[#ffb1aa]" : "border-white/10 text-white/60"}`}>Over {minutes} min</button>)}
    </section>
  </div>;
}
