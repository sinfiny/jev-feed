"use client";

import { HandleSSOCallback } from "@clerk/react";

/** Google returns here after sign-in. A first sign-in becomes a sign-up without another step, since Google is the only way in. */
export default function SSOCallback() {
  const home = () => window.location.replace("/");
  return <div className="min-h-screen bg-[var(--ink)]"><HandleSSOCallback navigateToApp={home} navigateToSignIn={home} navigateToSignUp={home} /></div>;
}
