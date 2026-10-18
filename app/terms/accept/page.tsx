import { redirect } from "next/navigation";
import { getVerifiedUserContext } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { TermsConsentForm } from "./terms-consent-form";

export const dynamic = "force-dynamic";
export default async function AcceptTermsPage() {
 const context = await getVerifiedUserContext();
 if (!context) redirect("/sign-in");
 const { data, error } = await createAdminClient().from("player_terms_acceptances").select("terms_version").eq("player_id",context.userId).maybeSingle();
 if (!error && data?.terms_version === "2026-10-18") redirect("/");
 return <section className="page-section shell"><TermsConsentForm /></section>;
}
