import type { Video } from "@/lib/learning";
import { parseWatchPage, readTextLimited, videoFromOEmbed, videoFromPlayerResponse, videoIdFrom } from "@/lib/youtube-playlist";

export const runtime = "edge";

// Watch pages are ~1.4 MB each, so one request resolves at most this many videos.
const MAX_IDS = 10;

const HEADERS = { "User-Agent": "Mozilla/5.0 (compatible; JevFeed/1.0)" };
const init = (extra: RequestInit = {}) => ({ ...extra, headers: { ...HEADERS, ...extra.headers }, signal: AbortSignal.timeout(8_000) }) as RequestInit;

type Attempt = { source: string; status: number; playability?: string; video: Video | null };

const player = (id: string, clientName: string, clientVersion: string) => async (): Promise<Attempt> => {
  const response = await fetch("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", init({
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ videoId: id, context: { client: { clientName, clientVersion, hl: "en" } } }),
  }));
  const body = response.ok ? await response.json() as { playabilityStatus?: { status?: string } } : null;
  return { source: `innertube:${clientName}`, status: response.status, playability: body?.playabilityStatus?.status, video: body ? videoFromPlayerResponse(body, id) : null };
};

const watchPage = (id: string) => async (): Promise<Attempt> => {
  const response = await fetch(`https://www.youtube.com/watch?v=${encodeURIComponent(id)}&hl=en`, init({ cf: { cacheTtl: 86_400 } } as RequestInit));
  return { source: "watch-page", status: response.status, video: response.ok ? parseWatchPage(await readTextLimited(response, 3_000_000), id) : null };
};

const oEmbed = (id: string) => async (): Promise<Attempt> => {
  const response = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}&format=json`, init({ cf: { cacheTtl: 86_400 } } as RequestInit));
  return { source: "oembed", status: response.status, video: response.ok ? videoFromOEmbed(await response.json(), id) : null };
};

/**
 * Sources, richest first. The innertube player endpoint returns the full metadata as ~10 KB of JSON,
 * even when playback is reported as unplayable. The watch page carries the same JSON inside 1.4 MB of HTML.
 * oEmbed always answers but only knows title, author, and thumbnail. YouTube gates some of these for
 * datacenter addresses, so the order is a best guess and `?debug=1` shows what each source returned.
 */
const sources = (id: string) => [player(id, "WEB", "2.20240101.00.00"), player(id, "MWEB", "2.20240101.00.00"), watchPage(id), oEmbed(id)];

async function fetchVideo(id: string): Promise<Video | null> {
  for (const attempt of sources(id)) {
    const result = await attempt().catch(() => null);
    if (result?.video) return result.video;
  }
  return null;
}

async function debugVideo(id: string) {
  return Promise.all(sources(id).map((attempt) => attempt().then(({ video, ...rest }) => ({ ...rest, ok: !!video, fields: video ? Object.keys(video).filter((key) => video[key as keyof Video] !== undefined) : [] })).catch((error: unknown) => ({ source: "error", status: 0, ok: false, error: String(error) }))));
}

/**
 * GET /api/video?ids=<id or url>,<id or url>
 * Resolves single videos from their public watch pages. Used to add one video to a playlist,
 * to enrich playlist videos that arrived without a description, and to hydrate /feed links built from video ids.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const raw = params.get("ids") ?? "";
  const ids = [...new Set(raw.split(",").map(videoIdFrom).filter(Boolean))];
  if (!ids.length) return Response.json({ error: "Paste a YouTube video link, such as youtube.com/watch?v=… or youtu.be/…" }, { status: 400 });
  if (ids.length > MAX_IDS) return Response.json({ error: `Send at most ${MAX_IDS} videos per request.` }, { status: 400 });
  if (params.get("debug") === "1") return Response.json({ id: ids[0], attempts: await debugVideo(ids[0]) }, { headers: { "Cache-Control": "no-store" } });

  const videos = (await Promise.all(ids.map(fetchVideo))).filter((video): video is Video => video !== null);
  if (!videos.length) return Response.json({ error: "That video could not be read. It may be private or removed." }, { status: 404 });
  return Response.json({ videos }, { headers: { "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800" } });
}
