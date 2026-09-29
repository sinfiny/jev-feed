declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    /** Published feeds, one JSON snapshot per short id. See app/api/feeds. */
    FEEDS?: KVNamespace;
    /** Secret. Enables lens questions judged by Claude (app/api/judge). */
    ANTHROPIC_API_KEY?: string;
  }
}
