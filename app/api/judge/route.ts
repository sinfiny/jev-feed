import Anthropic from "@anthropic-ai/sdk";
import { env } from "cloudflare:workers";
import { JUDGE_BATCH, JUDGE_QUESTIONS, JUDGE_SYSTEM, judgePrompt, judgeSchema, readJudgments, type JudgeVideo } from "@/lib/judge";
import { failure, viewerId } from "../account/google";

export const runtime = "edge";

/**
 * POST /api/judge {videos, questions} — Claude scores up to 20 videos against up to 5 of a lens's questions.
 * Signed-in organizers only, since it spends API credit. The browser caches every answer per video and
 * question, so each video is judged once; published feeds carry the answers so viewers never call this.
 */
export async function POST(request: Request) {
  try {
    await viewerId(request);
  } catch (error) { return failure(error); }
  if (!env.ANTHROPIC_API_KEY) return Response.json({ error: "Questions need Claude, which is not switched on for this deployment." }, { status: 503 });

  const body = await request.json().catch(() => null) as { videos?: JudgeVideo[]; questions?: unknown } | null;
  const questions = Array.isArray(body?.questions) ? body.questions.filter((item): item is string => typeof item === "string" && !!item.trim()).map((item) => item.slice(0, 160)).slice(0, JUDGE_QUESTIONS) : [];
  const videos = Array.isArray(body?.videos) ? body.videos.filter((video) => typeof video?.id === "string" && typeof video.title === "string").slice(0, JUDGE_BATCH) : [];
  if (!questions.length || !videos.length) return Response.json({ error: "Send at least one question and one video." }, { status: 400 });

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  try {
    const response = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 4000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: { type: "json_schema", schema: judgeSchema(questions.length) } },
      system: JUDGE_SYSTEM,
      messages: [{ role: "user", content: judgePrompt(videos, questions) }],
    });
    if (response.stop_reason === "refusal") return Response.json({ error: "Claude declined to judge these videos." }, { status: 422 });
    const text = response.content.flatMap((block) => block.type === "text" ? [block.text] : []).join("");
    const json = (() => { try { return JSON.parse(text) as unknown; } catch { return null; } })();
    return Response.json({ judgments: readJudgments(json, videos.map((video) => video.id), questions) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) return Response.json({ error: "Claude is busy. Try again in a minute." }, { status: 429 });
    if (error instanceof Anthropic.AuthenticationError) return Response.json({ error: "Claude's key for this deployment is not valid." }, { status: 503 });
    if (error instanceof Anthropic.APIError) return Response.json({ error: "Claude could not judge these videos right now." }, { status: 502 });
    return Response.json({ error: "Claude could not be reached." }, { status: 502 });
  }
}
