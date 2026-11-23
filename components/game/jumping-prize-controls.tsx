"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Props = {
  enabled: boolean;
  week: string;
  playerId?: string;
  state?: string;
  balanceCents?: number;
  winnerId?: string;
  credited?: boolean;
};

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export function JumpingPrizeControls({ enabled, week, playerId, state, balanceCents = 0, winnerId, credited = false }: Props) {
  const [code, setCode] = useState("");
  const [identityChecked, setIdentityChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const router = useRouter();

  async function call(url: string, body: Record<string, unknown>) {
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", cache: "no-store", body: JSON.stringify(body) });
    const result = await response.json().catch(() => null) as { message?: string } | null;
    if (!response.ok) throw new Error(result?.message || "La operación no fue aceptada.");
    return result?.message || "Operación registrada.";
  }

  async function activate() {
    if (busy || !window.confirm("¿Activar el programa de premios de Jumping Race desde esta semana? No se crearán premios ni saldos automáticamente.")) return;
    setBusy(true); setMessage("");
    try { setMessage(await call("/api/admin/jumping-race/prizes", { action: "activate", confirmed: true })); router.refresh(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo activar el programa."); }
    finally { setBusy(false); }
  }

  function generateCode() {
    const value = new Uint32Array(1); crypto.getRandomValues(value);
    setCode(String(value[0] % 1_000_000).padStart(6, "0"));
    setIdentityChecked(false); setMessage("Código local generado. Envíalo personalmente; no se guarda ni se valida automáticamente.");
  }

  async function act(action: "approved" | "rejected" | "needs_additional_review" | "allocate" | "paid") {
    if (busy || !playerId) return;
    if (action === "allocate" && (!identityChecked || state !== "approved" || credited)) return;
    if (action === "paid" && (!identityChecked || !winnerId || !credited || balanceCents < 2000)) return;
    const labels = { approved: "aprobar al candidato", rejected: "rechazar al candidato", needs_additional_review: "solicitar revisión adicional", allocate: "acreditar el premio al balance compartido", paid: "registrar un pago externo ya realizado" };
    if (!window.confirm(`¿Confirmas ${labels[action]}? Esta acción queda auditada; el sistema nunca envía dinero.`)) return;
    setBusy(true); setMessage("");
    try {
      const message = action === "allocate"
        ? await call("/api/admin/jumping-race/prizes", { week, playerId, action })
        : action === "paid"
          ? await call("/api/admin/jumping-race/confirm-payment", { week, playerId, winnerId, confirmedPaidByOwner: true })
          : await call("/api/admin/jumping-race/review", { week, playerId, action, confirmed: true });
      setMessage(message); router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "No se confirmó ningún cambio."); }
    finally { setBusy(false); }
  }

  if (!enabled) return <section className="profile-card" style={{ padding: "1rem", margin: "1rem 0" }}>
    <h3>Programa de premios de Jumping Race</h3>
    <p>Está desactivado. Activarlo inicia elegibilidad desde la semana actual: no convierte resultados históricos en premios ni cambia balances.</p>
    <button className="button button--primary" type="button" disabled={busy} onClick={() => void activate()}>{busy ? "ACTIVANDO…" : "ACTIVAR PROGRAMA DESDE ESTA SEMANA"}</button>
    {message && <p role="status">{message}</p>}
  </section>;

  if (!playerId || !state) return null;
  return <section style={{ display: "grid", gap: ".75rem", margin: "1rem 0" }}>
    <h3>Verificación humana, crédito y pago manual</h3>
    <button className="button button--secondary" type="button" onClick={generateCode}>GENERAR CÓDIGO</button>
    {code && <><strong style={{ fontSize: "1.4rem", letterSpacing: ".18em" }}>{code}</strong><button className="button button--secondary" type="button" onClick={() => void navigator.clipboard?.writeText(code)}>COPIAR CÓDIGO</button></>}
    <label><input type="checkbox" checked={identityChecked} onChange={event => setIdentityChecked(event.target.checked)} /> Confirmo que verifiqué manualmente la identidad y el código con el jugador.</label>
    <p>La decisión, la cuenta administradora y la fecha se registran automáticamente en el historial de auditoría.</p>
    <button className="button button--secondary" type="button" disabled={busy || state !== "pending_review"} onClick={() => void act("approved")}>APROBAR CANDIDATO</button>
    <button className="button button--primary" type="button" disabled={busy || !identityChecked || state !== "approved" || credited} onClick={() => void act("allocate")}>{credited ? "PREMIO YA ACREDITADO" : "VALIDAR Y ACREDITAR PREMIO"}</button>
    <p>Balance compartido: {money(balanceCents)}. El crédito nunca realiza un pago.</p>
    <button className="button button--primary" type="button" disabled={busy || !identityChecked || !credited || !winnerId || balanceCents < 2000} onClick={() => void act("paid")}>PAGO EXTERNO EXITOSO · DEJAR BALANCE EN $0</button>
    <details><summary>Otras decisiones</summary><button className="button button--secondary" type="button" disabled={busy || credited} onClick={() => void act("needs_additional_review")}>REVISIÓN ADICIONAL</button><button className="button button--secondary" type="button" disabled={busy || credited} onClick={() => void act("rejected")}>RECHAZAR CANDIDATO</button></details>
    {message && <p role="status">{message}</p>}
  </section>;
}
