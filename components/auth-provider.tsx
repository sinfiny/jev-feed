"use client";

import { ClerkProvider } from "@clerk/react";
import type { ReactNode } from "react";

/**
 * Clerk's React SDK rather than @clerk/nextjs: the Next.js package's server pieces do not run on Vinext.
 * The session is checked in the API routes that need it (app/api/account), so there is no middleware.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  return <ClerkProvider publishableKey={process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY!} afterSignOutUrl="/">{children}</ClerkProvider>;
}
