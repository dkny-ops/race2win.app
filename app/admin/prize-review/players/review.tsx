"use client";
import { useEffect, useState } from "react";
type Player = {
  id: string; username: string | null; createdAt: string; email: string | null;
  balanceCents: number;
  sessions: { id: string; status: string; started_at: string; final_score: number | null; final_elapsed_ms: number | null; final_distance_millimeters: number | null }[];
  runs: { score: number; completed_at: string; eligibility_status: string }[];
  weekly: { tournament_week_start: string; weekly_total_score: number; rank_position: number }[];
  flags: { severity: string; status: string; signal_summary: string; created_at: string }[];
};
const date = (v: string) => new Date(v).toLocaleString("es", { timeZone: "America/New_York" });
export function PlayersReview() {
  const [q,setQ] = useState("");
  const [players,setPlayers] = useState<Player[]>([]);
  const [loading,setLoading] = useState(false);
  const [error,setError] = useState("");
  const [selected,setSelected] = useState<string | null>(null);
  async function load(query: string) {
    setLoading(true);setError("");
    try {
      const response = await fetch("/api/admin/players?q=" + encodeURIComponent(query), { cache: "no-store" });
      if (!response.ok) throw new Error("No se pudo cargar la información.");
      const body = await response.json() as { players: Player[] };
      setPlayers(body.players);setSelected(null);
    } catch(e) {setError(e instanceof Error ? e.message : "Error de consulta");setPlayers([]);}
    finally {setLoading(false);}
  }
  useEffect(() => { void load(""); }, []);
  return <section>
    <form onSubmit={e=>{e.preventDefault();void load(q);}} className="button-row" style={{alignItems:"center"}}>
      <input aria-label="Buscar username o ID" placeholder="Username o ID del jugador" value={q} onChange={e=>setQ(e.target.value)} maxLength={80} style={{flex:"1 1 220px",padding:".85rem",background:"#071320",color:"white",border:"1px solid #5a7184"}} />
      <button className="button button--primary" type="submit" disabled={loading}>{loading?"CARGANDO…":"BUSCAR JUGADOR"}</button>
    </form>
    {error && <p role="alert">{error}</p>}
    <p>{players.length} jugadores mostrados (máximo 50 por consulta).</p>
    {players.map(p=><article key={p.id} style={{border:"1px solid #405469",padding:"1rem",marginBottom:"1rem",overflowWrap:"anywhere"}}>
      <h2 style={{fontSize:"1.1rem"}}>{p.username || "Sin username"}</h2>
      <p><strong>ID:</strong> <code>{p.id}</code></p>
      <button type="button" className="button button--secondary" onClick={()=>setSelected(selected===p.id?null:p.id)}>{selected===p.id?"CERRAR FICHA":"VER FICHA"}</button>
      {selected===p.id && <div style={{marginTop:"1rem"}}>
        <p><strong>Correo confirmado:</strong> {p.email || "No disponible"}</p>
        <p><strong>Registro:</strong> {date(p.createdAt)} (Nueva York)</p>
        <p><strong>Balance disponible:</strong> {"$" + (Number(p.balanceCents)/100).toFixed(2)}</p>
        <h3>Resultados semanales</h3>
        {p.weekly.length ? p.weekly.map((w,i)=><p key={i}>{w.tournament_week_start}: {w.weekly_total_score} puntos · posición {w.rank_position}</p>):<p>Sin resultados semanales.</p>}
        <h3>Últimas partidas</h3>
        {p.sessions.length ? p.sessions.map(s=><p key={s.id}>{date(s.started_at)} · {s.status} · {s.final_score ?? "Sin puntuación"} puntos · {s.final_elapsed_ms == null ? "—" : Math.round(s.final_elapsed_ms/1000)+" s"} · {s.final_distance_millimeters == null ? "—" : (s.final_distance_millimeters/1000000).toFixed(1)+" km"}</p>):<p>Sin partidas.</p>}
        <h3>Resultados validados</h3>
        {p.runs.length ? p.runs.map((r,i)=><p key={i}>{date(r.completed_at)} · {r.score} puntos · {r.eligibility_status}</p>):<p>Sin resultados validados.</p>}
        <h3>Alertas de seguridad</h3>
        {p.flags.length ? p.flags.map((f,i)=><p key={i}>{date(f.created_at)} · {f.severity} · {f.status}: {f.signal_summary}</p>):<p>Sin alertas registradas.</p>}
      </div>}
    </article>)}
  </section>;
}
