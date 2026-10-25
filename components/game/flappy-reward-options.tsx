"use client";
import { useState } from "react";
import { FLAPPY_REWARDS } from "@/lib/game/flappy/rewards";

export function FlappyRewardOptions({ es, onOpenChange }: { es: boolean; onOpenChange?: (open: boolean) => void }) {
  const [open, setOpen] = useState(false);
  return <div style={{ maxWidth: 360, margin: "12px auto", width: "100%" }}>
    <button type="button" className="button" aria-expanded={open} onClick={() => { setOpen(!open); onOpenChange?.(!open); }}>
      EXTRA LIFE · {es ? "PRÓXIMAMENTE" : "COMING SOON"}
    </button>
    {open ? <div role="status" style={{ padding: 12 }}>
      <p>{es ? "La vida extra todavía no está disponible. Puedes consultar esta opción sin ver anuncios ni cambiar tu partida." : "Extra Life is not available yet. You can inspect this option without watching ads or changing your run."}</p>
      <p>{es ? "Requiere una recompensa verificada por el servidor y reglas de continuación aprobadas. No se ha concedido ninguna vida extra." : "Requires a server-verified reward and approved continuation rules. No extra life has been granted."}</p>
      <button type="button" className="button" disabled={!FLAPPY_REWARDS.extraLifeAvailable}>{es ? "VER ANUNCIO · NO DISPONIBLE" : "WATCH AD · UNAVAILABLE"}</button>
    </div> : null}
  </div>;
}
