"use client";

import { createBrowserClient } from "@supabase/ssr";

function getSupabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) throw new Error("Supabase public environment variables are not configured.");
  return { url, publishableKey };
}

// @supabase/ssr uses cookie-backed session storage; this app does not use localStorage manually.
export function createClient() {
  const { url, publishableKey } = getSupabaseConfig();
  return createBrowserClient(url, publishableKey, { auth: { flowType: "pkce" } });
}
