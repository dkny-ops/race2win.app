import Link from "next/link";
import { notFound } from "next/navigation";
import { getAuthorizedPrizeAdmin } from "@/lib/security/prize-admin";
import { Auth401Review } from "./review";
export const dynamic = "force-dynamic";
export default async function Page() {
  if (!(await getAuthorizedPrizeAdmin())) notFound();
  return <main className="page-section shell narrow"><Link href="/admin/prize-review" className="button button--secondary" style={{ marginBottom: "1.5rem" }}>← VOLVER AL PANEL</Link><h1>REVISAR ACCESOS 401</h1><p>Incidentes de autenticación. Los casos anónimos requieren identificación verificada antes de autorizar una cuenta.</p><Auth401Review /></main>;
}
