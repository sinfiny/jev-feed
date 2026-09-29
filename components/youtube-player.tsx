"use client";

import { useEffect, useImperativeHandle, useRef, type Ref } from "react";

/** The slice of YouTube's IFrame Player API that Jev drives. */
type YTPlayer = {
  loadVideoById: (clip: { videoId: string; startSeconds?: number; endSeconds?: number }) => void;
  cueVideoById: (clip: { videoId: string; startSeconds?: number; endSeconds?: number }) => void;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  getCurrentTime: () => number;
  getPlayerState: () => number;
  playVideo: () => void;
  pauseVideo: () => void;
  setPlaybackRate: (rate: number) => void;
  destroy: () => void;
};
type YTNamespace = { Player: new (element: HTMLElement, options: object) => YTPlayer };

declare global { interface Window { YT?: YTNamespace; onYouTubeIframeAPIReady?: () => void } }

const ENDED = 0;
const PLAYING = 1;

let api: Promise<YTNamespace> | undefined;
function loadApi() {
  api ??= new Promise((resolve) => {
    if (window.YT?.Player) return resolve(window.YT);
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { previous?.(); resolve(window.YT!); };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(script);
  });
  return api;
}

/** What to play. A chapter clip carries an end; `nonce` makes choosing the same clip again restart it. */
export type Clip = { videoId: string; start: number; end?: number; autoplay: boolean; nonce: number };

export type PlayerHandle = {
  time: () => number;
  seek: (seconds: number) => void;
  togglePlay: () => void;
};

type Props = { clip: Clip; rate: number; onEnded: () => void; ref?: Ref<PlayerHandle> };

/**
 * YouTube's own player, with its native controls, driven through the IFrame API so Jev's control bar
 * can change speed, seek, and read the time for bookmarks and resume.
 */
export function YouTubePlayer({ clip, rate, onEnded, ref }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const player = useRef<YTPlayer | null>(null);
  const ready = useRef(false);
  const loaded = useRef(clip.nonce);
  const latest = useRef({ clip, rate, onEnded });
  useEffect(() => { latest.current = { clip, rate, onEnded }; });

  /** Loads the newest clip once the player exists; clips chosen before it was ready are applied on ready. */
  const sync = useRef(() => {
    const { clip: next } = latest.current;
    if (!ready.current || !player.current || next.nonce === loaded.current) return;
    loaded.current = next.nonce;
    const options = { videoId: next.videoId, startSeconds: next.start, endSeconds: next.end };
    if (next.autoplay) player.current.loadVideoById(options); else player.current.cueVideoById(options);
  });

  useImperativeHandle(ref, () => ({
    time: () => (ready.current ? player.current?.getCurrentTime() : 0) ?? 0,
    seek: (seconds) => { if (ready.current) { player.current?.seekTo(Math.max(0, seconds), true); player.current?.playVideo(); } },
    togglePlay: () => { if (!ready.current) return; if (player.current?.getPlayerState() === PLAYING) player.current.pauseVideo(); else player.current?.playVideo(); },
  }), []);

  useEffect(() => {
    let cancelled = false;
    const target = document.createElement("div");
    host.current?.appendChild(target);
    void loadApi().then((YT) => {
      if (cancelled) return;
      const { clip: first } = latest.current;
      player.current = new YT.Player(target, {
        host: "https://www.youtube-nocookie.com",
        videoId: first.videoId,
        width: "100%",
        height: "100%",
        playerVars: { start: Math.floor(first.start), ...(first.end ? { end: Math.ceil(first.end) } : {}), autoplay: first.autoplay ? 1 : 0, rel: 0, playsinline: 1 },
        events: {
          onReady: () => { ready.current = true; player.current?.setPlaybackRate(latest.current.rate); sync.current(); },
          onStateChange: (event: { data: number }) => {
            if (event.data === PLAYING) player.current?.setPlaybackRate(latest.current.rate);
            if (event.data === ENDED) latest.current.onEnded();
          },
        },
      });
    });
    return () => { cancelled = true; ready.current = false; player.current?.destroy(); player.current = null; target.remove(); };
  }, []);

  useEffect(() => { latest.current.clip = clip; sync.current(); }, [clip]);

  useEffect(() => { if (ready.current) player.current?.setPlaybackRate(rate); }, [rate]);

  return <div ref={host} className="aspect-video w-full overflow-hidden bg-black [&>div]:size-full [&_iframe]:size-full" />;
}
