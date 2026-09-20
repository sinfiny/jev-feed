import type { Video } from "@/lib/learning";
import { mergeVideos, readTextLimited, videoFromNextResponse, videoFromOEmbed, videoFromPlayerResponse, videoFromSearchPage, videoIdFrom } from "@/lib/youtube-playlist";

export const runtime = "edge";

// Watch pages are ~1.4 MB each, so one request resolves at most this many videos.
const MAX_IDS = 10;

const HEADERS = { "User-Agent": "Mozilla/5.0 (compatible; JevFeed/1.0)" };
const init = (extra: RequestInit = {}) => ({ ...extra, headers: { ...HEADERS, ...extra.headers }, signal: AbortSignal.timeout(8_000) }) as RequestInit;

type Attempt = { source: string; status: number; playability?: string; video: Video | null };

const innertube = (endpoint: "player" | "next", id: string) => fetch(`https://www.youtube.com/youtubei/v1/${endpoint}?prettyPrint=false`, init({
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ videoId: id, context: { client: { clientName: "WEB", clientVersion: "2.20240101.00.00", hl: "en" } } }),
}));

const player = (id: string) => async (): Promise<Attempt> => {
  const response = await innertube("player", id);
  const body = response.ok ? await response.json() as { playabilityStatus?: { status?: string } } : null;
  return { source: "player", status: response.status, playability: body?.playabilityStatus?.status, video: body ? videoFromPlayerResponse(body, id) : null };
};

const next = (id: string) => async (): Promise<Attempt> => {
  const response = await innertube("next", id);
  return { source: "next", status: response.status, video: response.ok ? videoFromNextResponse(await response.json(), id) : null };
};

const search = (id: string) => async (): Promise<Attempt> => {
  const response = await fetch(`https://www.youtube.com/results?search_query=${id}&hl=en`, init({ cf: { cacheTtl: 86_400 } } as RequestInit));
  return { source: "search", status: response.status, video: response.ok ? videoFromSearchPage(await readTextLimited(response, 3_000_000), id) : null };
};

const oEmbed = (id: string) => async (): Promise<Attempt> => {
  const response = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}&format=json`, init({ cf: { cacheTtl: 86_400 } } as RequestInit));
  return { source: "oembed", status: response.status, video: response.ok ? videoFromOEmbed(await response.json(), id) : null };
};

const attempt = (run: () => Promise<Attempt>) => run().then((result) => result.video).catch(() => null);

/**
 * Richest source first. The `player` endpoint has everything (length, category, keywords) but YouTube
 * turns it away for datacenter addresses with LOGIN_REQUIRED. `next` (description, views, date, chapters)
 * and a search for the id (length, snippet) are served to Workers and are merged. oEmbed always answers
 * with title, author, and thumbnail. `?debug=1` shows what each source returned from where the Worker runs.
 */
async function fetchVideo(id: string): Promise<Video | null> {
  const fromPlayer = await attempt(player(id));
  if (fromPlayer) return fromPlayer;
  const [fromNext, fromSearch] = await Promise.all([attempt(next(id)), attempt(search(id))]);
  const merged = mergeVideos(id, fromNext, fromSearch);
  if (merged) return merged;
  return attempt(oEmbed(id));
}

async function debugVideo(id: string) {
  return Promise.all([player(id), next(id), search(id), oEmbed(id)].map((run) => run()
    .then(({ video, ...rest }) => ({ ...rest, ok: !!video, fields: video ? Object.keys(video).filter((key) => video[key as keyof Video] !== undefined && video[key as keyof Video] !== "") : [] }))
    .catch((error: unknown) => ({ source: "error", status: 0, ok: false, error: String(error) }))));
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
