/** Pulls the useful message out of Clerk's nested API errors without depending on its runtime classes. */
export function oauthErrorMessage(cause: unknown, fallback: string) {
  if (cause && typeof cause === "object") {
    const errors = "errors" in cause && Array.isArray(cause.errors) ? cause.errors : [];
    for (const error of errors) {
      if (!error || typeof error !== "object") continue;
      const long = "longMessage" in error && typeof error.longMessage === "string" ? error.longMessage.trim() : "";
      const short = "message" in error && typeof error.message === "string" ? error.message.trim() : "";
      if (long || short) return long || short;
    }
  }
  return cause instanceof Error && cause.message.trim() ? cause.message : fallback;
}
