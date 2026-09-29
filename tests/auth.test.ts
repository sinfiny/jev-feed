import { describe, expect, it } from "vitest";
import { oauthErrorMessage } from "@/lib/auth";

describe("OAuth errors", () => {
  it("prefers Clerk's useful nested message", () => {
    expect(oauthErrorMessage({ errors: [{ message: "Short", longMessage: "Google access was denied." }] }, "Fallback")).toBe("Google access was denied.");
    expect(oauthErrorMessage({ errors: [{ message: "Google access was denied." }] }, "Fallback")).toBe("Google access was denied.");
  });

  it("falls back through ordinary and unknown errors", () => {
    expect(oauthErrorMessage(new Error("The network is offline."), "Fallback")).toBe("The network is offline.");
    expect(oauthErrorMessage({ errors: [{}] }, "Fallback")).toBe("Fallback");
    expect(oauthErrorMessage(null, "Fallback")).toBe("Fallback");
  });
});
