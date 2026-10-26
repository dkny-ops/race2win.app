import { createAdminClient } from "@/lib/supabase/admin";

type Related = { playerId: string; username: string | null; signal: string; sharedDays: number; confidence: string };
type Signal = { severity: string; status: string; reason: string; at: string };
const labels: Record<string, string> = {
  shared_network: "Conexión compartida (informativa; no demuestra identidad común)",
  shared_payout_contact: "Contacto de cobro coincidente (declarado por el usuario; sin verificar)",
  verified_email_conflict: "Correo verificado coincidente",
};
export async function CompetitionIdentityEvidence({ actor, player, week }: { actor: string; player: string; week: string }) {
  const { data, error } = await createAdminClient().rpc("rtw_admin_identity_evidence", { p_actor: actor, p_player: player, p_week: week });
  if (error || !data) return <p role="status">Evidencia de identidad no disponible; no interpretar como ausencia de riesgo.</p>;
  const related: Related[] = Array.isArray(data.relatedAccounts) ? data.relatedAccounts : [];
  const signals: Signal[] = Array.isArray(data.signals) ? data.signals : [];
  return <details>
    <summary>Señales antifraude y posibles cuentas relacionadas</summary>
    <p>Estado de identidad: {data.identityStatus}. Las coincidencias requieren revisión; no causan bloqueos automáticos por IP, red o contacto de cobro.</p>
    <p>Reputación VPN/proxy: proveedor pendiente. Señales de red disponibles durante 30 días. Sin identificadores de dispositivo.</p>
    {related.length ? <ul>{related.map((row, index) => <li key={index}>{row.username || "Cuenta sin nombre"} · {labels[row.signal] || row.signal} · confianza: {row.confidence}{row.sharedDays > 0 ? ` · ${row.sharedDays} días` : ""}</li>)}</ul> : <p>No hay coincidencias registradas en las fuentes disponibles. Esto no acredita una identidad única.</p>}
    {signals.map((signal, index) => <p key={index}>{signal.at} · {signal.severity} · {signal.status} · {signal.reason}</p>)}
  </details>;
}
