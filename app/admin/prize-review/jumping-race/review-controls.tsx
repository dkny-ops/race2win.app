"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

const decisions = [
  ["approved", "Aprobar candidato"],
  ["needs_additional_review", "Pedir revisión adicional"],
  ["rejected", "Rechazar candidato"],
] as const;

export function ReviewControls({ week, playerId }: { week: string; playerId?: string }) {
  const [note, setNote] = useState("");
  const [action, setAction] = useState<string>(decisions[0][0]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const router = useRouter();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || (playerId && !note.trim())) return;
    const label = playerId ? decisions.find(([key]) => key === action)?.[1] : "Cerrar la semana";
    if (!window.confirm(`¿Confirmas esta acción? ${label} · ${week}`)) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/jumping-race/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(playerId ? { week, action, playerId, note: note.trim(), confirmed: true }
          : { week, action: "close", confirmed: true }),
        cache: "no-store",
      });
      const result = await response.json() as { message: string };
      setMessage(result.message);
      if (response.ok) {
        setNote("");
        router.refresh();
      }
    } catch {
      setMessage("No se pudo comprobar el resultado. Actualiza el panel antes de reintentar.");
    } finally {
      setBusy(false);
    }
  }

  return <form onSubmit={submit}>
    {playerId && <>
      <label>Decisión{" "}
        <select value={action} onChange={event => setAction(event.target.value)}>
          {decisions.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
      </label>
      <label style={{ display: "block" }}>Motivo y evidencia
        <textarea required rows={3} maxLength={500} value={note}
          style={{ display: "block", width: "100%" }} onChange={event => setNote(event.target.value)} />
      </label>
    </>}
    <button className="button button--secondary" disabled={busy || Boolean(playerId && !note.trim())}>
      {playerId ? "REGISTRAR DECISIÓN" : "CERRAR SEMANA DE PREMIOS"}
    </button>
    {message && <p role="status">{message}</p>}
  </form>;
}
