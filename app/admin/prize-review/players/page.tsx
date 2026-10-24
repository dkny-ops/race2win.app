import Link from "next/link";
import { notFound } from "next/navigation";
import { getAuthorizedPrizeAdmin } from "@/lib/security/prize-admin";
import { PlayersReview } from "./review";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin · Jugadores", robots: { index: false, follow: false } };

export default async function Page() {
  if (!(await getAuthorizedPrizeAdmin())) notFound();
  return <main className="page-section shell narrow">
    <p className="eyebrow">OWNER REVIEW · SOLO LECTURA</p>
    <Link href="/admin/prize-review" className="button button--secondary" style={{ marginBottom: "1.5rem" }}>← VOLVER AL PANEL</Link>
    <h1>VER JUGADORES</h1>
    <p>Busca por username o ID. La información es privada y exclusiva de administración.</p>
    <PlayersReview />
  </main>;
}
