"use client";

import { useState } from "react";

export function BlockPlayerControl({ playerId, username }: { playerId: string; username: string }) {
  const [reason, setReason] = useState("");
  const [flagId, setFlagId] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [status, setStatus] = useState("");

  async function requestBlock() {
    setStatus("");
    if (!acknowledged || reason.trim().length < 20 || !flagId.trim()) {
      setStatus("Selecciona una alerta de fraude confirmado, escribe al menos 20 caracteres de evidencia y confirma la revisión.");
      return;
    }
    if (!window.confirm("¿Confirmas solicitar el bloqueo permanente de esta cuenta? La operación requiere validación del servidor.")) return;
    try {
      const response = await fetch("/api/admin/fraud-suspensions", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId, flagId: flagId.trim(), reason: reason.trim() }),
      });
      if (!response.ok) {
        setStatus(response.status === 405 ? "Bloqueo todavía no habilitado. Ninguna cuenta ha sido modificada." : "No se pudo autorizar el bloqueo. La cuenta permanece sin cambios.");
        return;
      }
      setStatus("Solicitud procesada. Comprueba el estado de la cuenta en el panel.");
    } catch {
      setStatus("No se pudo conectar con el servidor. No se confirmó ningún bloqueo.");
    }
  }

  return <details style={{ marginTop: "1rem", border: "1px solid #b76d6d", borderRadius: 10, padding: "0.85rem" }}>
    <summary style={{ cursor: "pointer", fontWeight: 700 }}>BLOQUEAR JUGADOR · {username}</summary>
    <p style={{ marginTop: "0.75rem" }}>Bloqueo permanente solo por fraude confirmado. Actualmente está deshabilitada la ejecución para proteger las cuentas de prueba.</p>
    <label style={{ display: "block", marginTop: "0.6rem" }}>ID de alerta de fraude confirmado
      <input value={flagId} onChange={(event) => setFlagId(event.target.value)} placeholder="UUID de la alerta confirmada" style={{ display: "block", width: "100%" }} />
    </label>
    <label style={{ display: "block", marginTop: "0.6rem" }}>Motivo y evidencia
      <textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={3} style={{ display: "block", width: "100%" }} />
    </label>
    <label style={{ display: "block", marginTop: "0.6rem" }}>
      <input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} /> He revisado las pruebas y confirmo el intento de fraude.
    </label>
    <button className="button button--secondary" type="button" disabled title="La ejecución de bloqueos permanece deshabilitada hasta finalizar las pruebas." onClick={() => void requestBlock()} style={{ marginTop: "0.75rem" }}>BLOQUEAR PERMANENTEMENTE (DESHABILITADO)</button>
    {status ? <p role="status">{status}</p> : null}
  </details>;
}
