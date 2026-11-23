import Link from "next/link";
import { notFound } from "next/navigation";
import { getAuthorizedPrizeAdmin } from "@/lib/security/prize-admin";
import { PlayersReview } from "./review";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin · Jugadores", robots: { index: false, follow: false } };

export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string | string[] }> }) {
  if (!(await getAuthorizedPrizeAdmin())) notFound();
  const query = (await searchParams).q;
  const initialQuery = typeof query === "string" ? query.slice(0, 80) : "";
  return <main className="page-section shell narrow">
    <p className="eyebrow">OWNER REVIEW · SOLO LECTURA</p>
    <Link href="/admin/prize-review" className="button button--secondary" style={{ marginBottom: "1.5rem" }}>← VOLVER AL PANEL</Link>
    <h1>VER JUGADORES</h1>
    <p>Busca por username o ID. La información es privada y exclusiva de administración.</p>
    <PlayersReview initialQuery={initialQuery} />
  </main>;
}
