"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
export function RtwCandidateRejection({ player, week }: { player: string; week: string }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const router = useRouter();
  return <form onSubmit={async event => {
    event.preventDefault(); setBusy(true);
    try {
      const result = await fetch("/api/admin/race-to-win/candidates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ playerId: player, week }) });
      const data = await result.json(); setMessage(data.message || "Revisión no disponible.");
      if (result.ok) router.refresh();
    } catch { setMessage("No se pudo registrar la decisión. Vuelve a intentarlo."); }
    finally { setBusy(false); }
  }}>
    <p>La decisión, la cuenta administradora y la fecha se guardan automáticamente en el historial del expediente.</p>
    <button type="submit" disabled={busy}>Rechazar candidato y presentar sustituto</button>
    <p role="status">{message}</p>
  </form>;
}
