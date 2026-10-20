"use client";

import { useState } from "react";

export function OwnerEmailCode({ playerId, winnerId }: { playerId: string; winnerId?: string }) {
  const [code, setCode] = useState("");
  const [compared, setCompared] = useState(false);
  const [message, setMessage] = useState("");
  const [paidConfirmed, setPaidConfirmed] = useState(false);
  const [contactClosed, setContactClosed] = useState(false);
  const [busy, setBusy] = useState(false);

  async function closeContact() {
    if (!winnerId || !paidConfirmed || busy) return;
    setBusy(true);
    try {
      const response = await fetch("/api/admin/winner-contact-close", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ winnerId, confirmedPaidByOwner: true }), cache: "no-store" });
      if (!response.ok) throw new Error("Unable to close contact");
      setContactClosed(true);
      setMessage("Contacto WhatsApp desactivado para este ganador. No se modificaron balances ni pagos.");
    } catch { setMessage("No se pudo desactivar WhatsApp."); }
    finally { setBusy(false); }
  }

  function generate() {
    const digits = new Uint32Array(1);
    crypto.getRandomValues(digits);
    setCode(String(digits[0] % 1000000).padStart(6, "0"));
    setCompared(false);
    setMessage("Código generado. Envíalo personalmente al correo registrado.");
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setMessage("Código copiado.");
    } catch {
      setMessage("No se pudo copiar automáticamente; selecciona el número.");
    }
  }

  return <div data-player-id={playerId} style={{ display: "grid", gap: "0.65rem", marginBottom: "1rem" }}>
    <button type="button" className="button" onClick={generate}>GENERAR CÓDIGO</button>
    {code ? <>
      <div style={{ padding: "0.75rem", border: "1px solid rgba(255,255,255,.25)", borderRadius: 8, fontSize: "1.4rem", letterSpacing: "0.15em", fontWeight: 700 }}>{code}</div>
      <button type="button" className="button" onClick={() => void copy()}>COPIAR CÓDIGO</button>
      <label style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
        <input type="checkbox" checked={compared} onChange={(event) => setCompared(event.target.checked)} />
        He cotejado personalmente el número recibido del jugador.
      </label>
      <p>{compared ? "Cotejo manual marcado en esta pantalla; no se guarda ni autoriza pagos." : "Pendiente de cotejo manual."}</p>
    </> : null}
    {winnerId ? <div style={{ display: "grid", gap: "0.5rem" }}>
      <label><input type="checkbox" checked={paidConfirmed} disabled={contactClosed} onChange={(event) => setPaidConfirmed(event.target.checked)} /> Confirmo que YO ya realicé el pago fuera de esta plataforma.</label>
      <button type="button" className="button" disabled={!paidConfirmed || busy || contactClosed} onClick={() => void closeContact()}>{contactClosed ? "CONTACTO CERRADO" : busy ? "GUARDANDO..." : "CONFIRMAR Y DESACTIVAR WHATSAPP"}</button>
      <p>Solo cierra el contacto de este premio; no registra un pago contable ni modifica saldos.</p>
    </div> : null}
    <p role="status" aria-live="polite">{message}</p>
  </div>;
}
