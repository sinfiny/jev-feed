"use client";

import { HandleSSOCallback, useClerk } from "@clerk/react";

/** Google returns here after sign-in. A first sign-in becomes a sign-up without another step, since Google is the only way in. */
export default function SSOCallback() {
  const clerk = useClerk();
  return <div className="grid min-h-screen place-items-center bg-[var(--ink)] text-sm text-white/55">
    <p>Finishing Google sign-in…</p>
    <HandleSSOCallback
      navigateToApp={({ decorateUrl }) => window.location.replace(decorateUrl("/"))}
      navigateToSignIn={() => { void clerk.redirectToSignIn({ signInFallbackRedirectUrl: "/" }); }}
      navigateToSignUp={() => { void clerk.redirectToSignUp({ signUpFallbackRedirectUrl: "/" }); }}
    />
  </div>;
}
