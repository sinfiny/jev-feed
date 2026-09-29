"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/react";
import type { Video } from "@/lib/learning";
import { mergeJudgments, parseJudgments, parseLens, questionKey, unjudged, type Judgments, type Lens } from "@/lib/lens";
import { JUDGE_BATCH, judgeVideo } from "@/lib/judge";
import { parseDrafts, type FeedDraft } from "@/lib/feed";
import { readStore, writeStore } from "@/lib/store";
import {
  emptyProgress, mergeVideoDetails, playlistSignature, readLibrary, syncPlaylists, videosById, writeLibrary, writeProgress,
  type LibraryPlaylist, type Progress,
} from "@/lib/library";
import type { AccountPlaylist } from "@/lib/youtube-account";

/** A failed call to app/api. 403 from the account routes means the Google sign-in lacks YouTube access. */
export class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
export const lacksYouTube = (cause: unknown) => cause instanceof ApiError && cause.status === 403;

export type SyncStatus = { label: string; done: number; total: number } | null;

const DETAILS_CHUNK = 50;
const ENRICH_CHUNK = 10;

/** Runs promises a few at a time, in order of the inputs. */
async function pool<T, R>(items: T[], size: number, run: (item: T) => Promise<R>) {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => { while (next < items.length) { const index = next++; results[index] = await run(items[index]); } }));
  return results;
}

async function fetchPublicVideos(ids: string[]) {
  const response = await fetch(`/api/video?ids=${encodeURIComponent(ids.join(","))}`);
  const result = await response.json().catch(() => ({})) as { videos?: Video[]; error?: string };
  if (!response.ok) throw new ApiError(result.error || "That video could not be read.", response.status);
  return result.videos ?? [];
}

/**
 * Everything the signed-in app keeps: the library and progress, custom lenses, Claude's cached judgments
 * and feed drafts. Loads from the browser first, then refreshes playlists from the viewer's YouTube account
 * without re-reading what has not changed.
 */
export function useJev(report: (problem: string) => void) {
  const { getToken } = useAuth();
  const [playlists, setPlaylists] = useState<LibraryPlaylist[]>([]);
  const [progress, setProgress] = useState<Progress>(emptyProgress);
  const [lenses, setLenses] = useState<Lens[]>([]);
  const [judgments, setJudgments] = useState<Judgments>({});
  const [drafts, setDrafts] = useState<FeedDraft[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [sync, setSync] = useState<SyncStatus>({ label: "Checking your playlists", done: 0, total: 0 });
  const [needsYouTube, setNeedsYouTube] = useState(false);
  const current = useRef(playlists);
  const reporter = useRef(report);
  useEffect(() => { current.current = playlists; reporter.current = report; });
  const setProblem = useCallback((problem: string) => { if (problem) reporter.current(problem); }, []);

  /** Same-origin calls that carry the Clerk session, for the account, feed and judge routes. */
  const api = useCallback(async <T,>(path: string, init: RequestInit = {}) => {
    const response = await fetch(path, { ...init, headers: { ...init.headers, Authorization: `Bearer ${await getToken()}` } });
    if (response.status === 204) return {} as T;
    const result = await response.json().catch(() => ({ error: "The server returned an unexpected response." })) as T & { error?: string };
    if (!response.ok) throw new ApiError(result.error || "Something went wrong. Try again.", response.status);
    return result;
  }, [getToken]);

  useEffect(() => {
    let stopped = false;
    void Promise.all([readLibrary(), readStore("lenses"), readStore("judgments"), readStore("feeds")]).then(([library, storedLenses, storedJudgments, storedDrafts]) => {
      if (stopped) return;
      setPlaylists(library.playlists); setProgress(library.progress);
      setLenses(Array.isArray(storedLenses) ? storedLenses.flatMap((item) => parseLens(item) ?? []) : []);
      setJudgments(parseJudgments(storedJudgments)); setDrafts(parseDrafts(storedDrafts));
      setLoaded(true);
    });
    return () => { stopped = true; };
  }, []);

  useEffect(() => { if (loaded) void writeLibrary(playlists); }, [playlists, loaded]);
  useEffect(() => { if (loaded) writeProgress(progress); }, [progress, loaded]);
  useEffect(() => { if (loaded) void writeStore("lenses", lenses); }, [lenses, loaded]);
  useEffect(() => { if (loaded) void writeStore("judgments", judgments); }, [judgments, loaded]);
  useEffect(() => { if (loaded) void writeStore("feeds", drafts); }, [drafts, loaded]);

  /**
   * One visit's refresh. For each playlist: read the first page of ids; if it matches last time, stop there.
   * Otherwise page through the ids and fetch details only for videos not already complete in the library.
   * Each playlist lands in the sidebar as soon as it is done.
   */
  const refresh = useCallback(async (full = false) => {
    setSync({ label: "Checking your playlists", done: 0, total: 0 });
    try {
      const { playlists: sources } = await api<{ playlists: AccountPlaylist[] }>("/api/account/playlists");
      const results = new Map<string, { videos?: Video[]; signature?: string }>();
      const land = () => setPlaylists((existing) => syncPlaylists(existing, sources.map((source) => ({ ...source, ...results.get(source.id) }))));
      let failed = 0;
      await pool(sources, 3, async (source) => {
        try {
          type Page = { ids: string[]; total: number; next: string };
          const base = `/api/account/playlist?id=${encodeURIComponent(source.id)}`;
          const first = await api<Page>(base);
          const signature = playlistSignature(first.total, first.ids);
          const existing = current.current.find((item) => item.sourcePlaylistId === source.id);
          if (!full && existing?.signature === signature) { results.set(source.id, {}); return; }
          const ids = [...first.ids];
          for (let next = first.next; next;) {
            setSync({ label: `Reading ${source.title}`, done: ids.length, total: first.total });
            const page = await api<Page>(`${base}&page=${encodeURIComponent(next)}`);
            ids.push(...page.ids); next = page.next;
          }
          const known = videosById(current.current);
          const missing = [...new Set(ids)].filter((id) => !known.get(id)?.complete);
          const fresh = new Map<string, Video>();
          const chunks = Array.from({ length: Math.ceil(missing.length / DETAILS_CHUNK) }, (_, index) => missing.slice(index * DETAILS_CHUNK, (index + 1) * DETAILS_CHUNK));
          let fetched = 0;
          await pool(chunks, 3, async (chunk) => {
            const { videos } = await api<{ videos: Video[] }>(`/api/account/videos?ids=${chunk.join(",")}`);
            videos.forEach((video) => fresh.set(video.id, video));
            fetched += chunk.length;
            if (missing.length > DETAILS_CHUNK) setSync({ label: `New in ${source.title}`, done: fetched, total: missing.length });
          });
          results.set(source.id, { signature, videos: ids.flatMap((id) => fresh.get(id) ?? known.get(id) ?? []) });
        } catch (cause) {
          if (lacksYouTube(cause)) throw cause;
          failed += 1;
          results.set(source.id, {});
        }
        land();
      });
      land();
      if (failed) setProblem(`${failed} playlist${failed === 1 ? "" : "s"} could not be refreshed. The copies saved here still work.`);
    } catch (cause) {
      if (lacksYouTube(cause)) setNeedsYouTube(true);
      else setProblem(cause instanceof Error ? cause.message : "Your playlists could not be loaded.");
    } finally { setSync(null); }
  }, [api, setProblem]);

  useEffect(() => { if (loaded) queueMicrotask(() => void refresh()); }, [loaded, refresh]);

  /** Fills in chapters (including YouTube's auto chapters) and counts for videos read before details were complete. Asked once per session. */
  const enriched = useRef(new Set<string>());
  const enrich = useCallback(async (videos: Video[]) => {
    const ids = [...new Set(videos.filter((video) => !enriched.current.has(video.id)).map((video) => video.id))];
    ids.forEach((id) => enriched.current.add(id));
    for (let start = 0; start < ids.length; start += ENRICH_CHUNK) {
      const details = await fetchPublicVideos(ids.slice(start, start + ENRICH_CHUNK)).catch(() => [] as Video[]);
      if (details.length) setPlaylists((existing) => mergeVideoDetails(existing, details));
    }
  }, []);
  useEffect(() => {
    if (!loaded || sync) return;
    const incomplete = playlists.flatMap((playlist) => playlist.videos).filter((video) => !video.complete && !enriched.current.has(video.id));
    if (incomplete.length) queueMicrotask(() => void enrich(incomplete));
  }, [loaded, sync, playlists, enrich]);

  /** Asks Claude the lens's unanswered questions about these videos, twenty at a time, caching every answer. */
  const [judging, setJudging] = useState<{ done: number; total: number } | null>(null);
  const judge = useCallback(async (videos: Video[], lens: Lens) => {
    const work = unjudged(videos, lens, judgments);
    if (!work.length) return;
    const pending = [...new Set(work.flatMap((item) => item.videos))];
    const questions = work.map((item) => item.question.text);
    setJudging({ done: 0, total: pending.length });
    try {
      for (let start = 0; start < pending.length; start += JUDGE_BATCH) {
        const batch = pending.slice(start, start + JUDGE_BATCH);
        const { judgments: fresh } = await api<{ judgments: Judgments }>("/api/judge", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ questions, videos: batch.map(judgeVideo) }) });
        setJudgments((existing) => mergeJudgments(existing, fresh));
        setJudging({ done: Math.min(pending.length, start + JUDGE_BATCH), total: pending.length });
      }
    } catch (cause) {
      setProblem(cause instanceof Error ? cause.message : "Claude could not judge these videos.");
    } finally { setJudging(null); }
  }, [api, judgments, setProblem]);

  const answered = useCallback((lens: Lens, videoId: string) => lens.questions.filter((question) => question.text.trim() && question.weight).every((question) => judgments[questionKey(question.text)]?.[videoId] !== undefined), [judgments]);

  return {
    api, loaded, playlists, setPlaylists, progress, setProgress, lenses, setLenses, judgments, drafts, setDrafts,
    sync, refresh, needsYouTube, enrich, judge, judging, answered,
  };
}

export type Jev = ReturnType<typeof useJev>;
