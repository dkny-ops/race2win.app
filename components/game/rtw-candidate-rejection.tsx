"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
export function RtwCandidateRejection({ player, week }: { player: string; week: string }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const router = useRouter();
  return <form onSubmit={async event => {
    event.preventDefault(); setBusy(true);
    try {
      const result = await fetch("/api/admin/race-to-win/candidates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ playerId: player, week, note }) });
      const data = await result.json(); setMessage(data.message || "Revisión no disponible.");
      if (result.ok) router.refresh();
    } catch { setMessage("No se pudo registrar la decisión. Vuelve a intentarlo."); }
    finally { setBusy(false); }
  }}>
    <label>Motivo del rechazo <input required maxLength={500} value={note} onChange={event => setNote(event.target.value)} /></label>
    <button type="submit" disabled={busy || !note.trim()}>Rechazar candidato y presentar sustituto</button>
    <p role="status">{message}</p>
  </form>;
}
