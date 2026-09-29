"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { FeedView } from "@/components/feed-view";
import { parsePublishedFeed, type PublishedFeed } from "@/lib/feed";

/** /feed/<id>: a feed an organizer published from the Studio, read from app/api/feeds/[id]. */
export default function PublishedFeedPage() {
  const id = useParams<{ id: string }>()?.id ?? "";
  const [loaded, setLoaded] = useState<{ feed: PublishedFeed | null; error: string }>({ feed: null, error: "" });

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/feeds/${encodeURIComponent(id)}`, { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => null) as unknown;
        if (!response.ok) throw new Error((body as { error?: string } | null)?.error || "This feed could not be loaded. Try again shortly.");
        const feed = parsePublishedFeed(body);
        if (!feed) throw new Error("This feed could not be read. Ask whoever shared it for a fresh link.");
        setLoaded({ feed, error: "" });
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setLoaded({ feed: null, error: cause instanceof Error ? cause.message : "This feed could not be loaded." });
      });
    return () => controller.abort();
  }, [id]);

  return <FeedView feed={loaded.feed} error={loaded.error} />;
}
