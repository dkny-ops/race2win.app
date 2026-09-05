import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ProfileForm } from "./profile-form";
import { ROUTES } from "@/lib/routes";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Profile" };

export default async function ProfilePage() {
  if (!isSupabaseConfigured()) redirect(ROUTES.signIn);
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims?.sub) redirect(ROUTES.signIn);

  return <section className="page-section"><div className="narrow"><p className="eyebrow">RACE CONTROL</p><h1>PLAYER PROFILE</h1><p className="page-lede">Manage your public player identity and private payout email.</p><ProfileForm /></div></section>;
}
