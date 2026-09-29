"use client";

import { useEffect, useState } from "react";
import { FeedView } from "@/components/feed-view";
import { MAX_FEED_ITEMS, type PublishedFeed } from "@/lib/feed";
import type { Video } from "@/lib/learning";
import { lensFromTemplate } from "@/lib/lens";
import { videoIdFrom } from "@/lib/youtube-playlist";

/** /api/video reads at most this many videos per request. */
const BATCH = 10;
/** Batches in flight at once. */
const PARALLEL = 4;

type Loaded = { feed: PublishedFeed | null; error: string; pending: number; youtubeUrl?: string };
type PlaylistResult = { playlist?: { id: string; title: string; channel: string }; videos?: Video[]; error?: string };

/** Older links carry no feed snapshot, so one is made from what they do carry. A `template=` becomes the matching preset lens. */
const legacyFeed = (title: string, videos: Video[], template: string | null, author?: string): PublishedFeed => ({
  v: 1, title: title.trim().slice(0, 80) || "Shared feed", blurb: "", emoji: "📺", color: "pink", ...author ? { author } : {},
  lens: lensFromTemplate(template), items: videos.map((video) => ({ video })), judgments: {}, publishedAt: 0,
});

async function fetchBatch(ids: string[], signal: AbortSignal) {
  const response = await fetch(`/api/video?ids=${encodeURIComponent(ids.join(","))}`, { signal });
  const result = await response.json().catch(() => ({})) as { videos?: Video[] };
  const byId = new Map((result.videos ?? []).map((video) => [video.id, video]));
  return ids.flatMap((id) => byId.get(id) ?? []);
}

/**
 * Reads videos in batches of ten, a few batches at a time. `onProgress` gets the videos read so far in link order,
 * stopping at the first batch still in flight, so the list only ever grows at the end.
 */
async function loadVideos(ids: string[], signal: AbortSignal, onProgress: (videos: Video[], pending: number) => void) {
  const batches = Array.from({ length: Math.ceil(ids.length / BATCH) }, (_, index) => ids.slice(index * BATCH, (index + 1) * BATCH));
  const results: Array<Video[] | undefined> = [];
  let next = 0;
  const report = () => {
    let ready = 0;
    while (ready < batches.length && results[ready]) ready += 1;
    onProgress(results.slice(0, ready).flat() as Video[], batches.slice(ready).reduce((sum, batch) => sum + batch.length, 0));
  };
  const worker = async () => {
    while (next < batches.length && !signal.aborted) {
      const index = next++;
      results[index] = await fetchBatch(batches[index], signal).catch(() => []);
      report();
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL, batches.length) }, worker));
}

/**
 * /feed?playlist=<id> and /feed?videos=a,b,c&title=…, the links shared before published feeds. Both keep working:
 * a playlist is read whole through /api/playlist, and a video list is hydrated through /api/video as it arrives.
 */
export default function LegacyFeedPage() {
  const [loaded, setLoaded] = useState<Loaded>({ feed: null, error: "", pending: 0 });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const playlistId = params.get("playlist")?.trim() ?? "";
    const template = params.get("template");
    const ids = [...new Set((params.get("videos") ?? "").split(",").map(videoIdFrom).filter(Boolean))].slice(0, MAX_FEED_ITEMS);
    const controller = new AbortController();
    const fail = (error: string) => { if (!controller.signal.aborted) setLoaded({ feed: null, error, pending: 0 }); };

    if (ids.length) {
      const title = params.get("title") ?? "";
      queueMicrotask(() => setLoaded({ feed: legacyFeed(title, [], template), error: "", pending: ids.length }));
      void loadVideos(ids, controller.signal, (videos, pending) => {
        if (controller.signal.aborted) return;
        if (!pending && !videos.length) return fail("None of these videos could be read. They may be private or removed.");
        setLoaded({ feed: legacyFeed(title, videos, template), error: "", pending });
      });
    } else if (playlistId) {
      fetch(`/api/playlist?url=${encodeURIComponent(playlistId)}`, { signal: controller.signal })
        .then(async (response) => {
          const result = await response.json().catch(() => ({})) as PlaylistResult;
          if (!response.ok || !result.playlist || !result.videos?.length) throw new Error(result.error || "This playlist could not be loaded. Try again shortly.");
          setLoaded({ feed: legacyFeed(result.playlist.title, result.videos, template, result.playlist.channel), error: "", pending: 0, youtubeUrl: `https://www.youtube.com/playlist?list=${encodeURIComponent(result.playlist.id)}` });
        })
        .catch((cause: unknown) => fail(cause instanceof Error ? cause.message : "This playlist could not be loaded."));
    } else {
      queueMicrotask(() => fail("This link is missing its playlist or videos. Ask whoever shared it for the full link."));
    }
    return () => controller.abort();
  }, []);

  return <FeedView feed={loaded.feed} error={loaded.error} pending={loaded.pending} youtubeUrl={loaded.youtubeUrl} />;
}
