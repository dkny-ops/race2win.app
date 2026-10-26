import { CompetitionIdentityEvidence } from "@/components/game/competition-identity-evidence";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FlappyWinnerCaseControls } from "@/components/game/flappy-winner-case-controls";
import { FlappyPrizeCaseControls } from "@/components/game/flappy-prize-case-controls";
import { getAuthorizedPrizeAdmin } from "@/lib/security/prize-admin";
import { parseFlappyWeek, previousFlappyWeek } from "@/lib/game/flappy/tournament";

export const dynamic = "force-dynamic";
export const metadata = { title: "FlappyRace · candidatos semanales", robots: { index: false, follow: false } };

type RecordValue = Record<string, unknown>;
const isRecord = (value: unknown): value is RecordValue => !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, fallback = "—") => typeof value === "string" || typeof value === "number" ? String(value) : fallback;
const rows = (value: unknown) => Array.isArray(value) ? value.filter(isRecord) : [];

function Scores({ value }: { value: unknown }) {
  return <ol>{Array.isArray(value) ? value.map((score, index) => <li key={index}>{text(score)}</li>) : <li>—</li>}</ol>;
}

export default async function FlappyRaceAdminPage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const authorization = await getAuthorizedPrizeAdmin();
  if (!authorization) notFound();

  const params = await searchParams;
  const week = params.week === undefined ? previousFlappyWeek() : parseFlappyWeek(params.week);
  if (!week) notFound();

  const { data, error } = await authorization.admin.rpc("flappy_admin_read_winner_cases", {
    p_actor: authorization.context.userId,
    p_week: week,
  });
  const dossier = !error && isRecord(data) ? data : null;
  const candidates = dossier ? rows(dossier.candidates).filter(candidate => typeof candidate.effectiveRank === "number" && candidate.effectiveRank >= 1 && candidate.effectiveRank <= 3) : [];
  const { data: prizeData, error: prizeError } = await authorization.admin.rpc("flappy_admin_read_prize_cases", {
    p_actor: authorization.context.userId,
    p_week: week,
  });
  const prizeDossier = !prizeError && isRecord(prizeData) ? prizeData : null;
  const prizeCandidates = prizeDossier ? rows(prizeDossier.candidates).filter(candidate => typeof candidate.effectiveRank === "number" && candidate.effectiveRank >= 1 && candidate.effectiveRank <= 3) : [];

  return <section className="page-section shell narrow">
    <Link href="/admin/prize-review">← Administración</Link>
    <h1>FlappyRace · cierre semanal</h1>
    <p>Expedientes exclusivos de los posibles ganadores. Las partidas ordinarias con replay autoritativo válido se clasifican automáticamente. Ninguna acción de esta pantalla crea premios, saldos ni pagos.</p>

    {!dossier ? <p role="status">El expediente semanal no está disponible.</p> : <>
      <p><strong>Semana NY:</strong> {week} · <strong>Cierre:</strong> {text(dossier.closedAt, "Aún no cerrado")}</p>
      {dossier.exactTiesPending === true ? <p role="alert">Existe un empate absoluto: no se ha seleccionado un ganador automático.</p> : null}
      {!candidates.length ? <p>No hay candidatos revisables para esta semana.</p> : null}

      {candidates.map((candidate) => {
        const playerId = text(candidate.playerId, "");
        const state = text(candidate.state);
        const effectiveRank = typeof candidate.effectiveRank === "number" ? candidate.effectiveRank : null;
        const days = rows(candidate.dailyTopSeven);
        const history = rows(candidate.history);

        return <article key={playerId} style={{ border: "1px solid #334155", borderRadius: 12, padding: 16, marginBlock: 16, overflowWrap: "anywhere" }}>
          <h2>{effectiveRank ? "#" + effectiveRank + " · " : "Expediente histórico · "}{text(candidate.username, "Sin nombre")}</h2>
          <p>Estado: <strong>{state}</strong> · Posición inicial: {text(candidate.openingRank)} · Total semanal: <strong>{text(candidate.weeklyTotal)}</strong></p>
          <p>Vector de desempate (puntuaciones individuales descendentes):</p>
          <Scores value={candidate.scores} />

          <h3>Siete mejores carreras por día</h3>
          {days.length ? days.map((day) => <details key={text(day.day)}>
            <summary>{text(day.day)} · evidencia incluida</summary>
            {rows(day.runs).map((run) => <p key={text(run.sessionId)}>
              {text(run.completedAt)} · score {text(run.score)} · tick {text(run.collisionTick)} · motor {text(run.version)} · entradas {text(run.inputCount)} · replay {run.replayVerified === true ? "verificado por servidor" : "requiere investigación"} · digest {text(run.digest)}
            </p>)}
          </details>) : <p>Sin carreras contables.</p>}

        <CompetitionIdentityEvidence actor={authorization.context.userId} player={playerId} week={week} />
          <h3>Señales y decisiones</h3>
          <p>La puntuación procede de replay autoritativo. Esto confirma integridad física, no humanidad. No se muestran semillas ni entradas crudas al navegador.</p>
          {history.length ? <ul>{history.map((event, index) => <li key={index}>{text(event.at)} · {text(event.decision)} · {text(event.note)}</li>)}</ul> : <p>Aún no hay decisiones administrativas.</p>}
          {effectiveRank !== null && effectiveRank <= 3 && (state === "pending_review" || state === "needs_additional_review")
            ? <FlappyWinnerCaseControls week={week} playerId={playerId} state={state} />
            : null}
        </article>;
      })}
    </>}

    <section style={{ marginTop: 36, borderTop: "1px solid #334155", paddingTop: 24 }}>
      <h2>FlappyRace · premios del período</h2>
      {!prizeDossier ? <p role="status">The prize-period dossier is unavailable.</p> : <>
        <p>Program: <strong>{prizeDossier.enabled === true ? "active" : "disabled"}</strong> · Effective server time: {text(prizeDossier.activatedAt)} · Inaugural week: {text(prizeDossier.inauguralWeekStart)}</p>
        <p>Only runs started after activation are eligible. Approving eligibility does not create money; the separate shared-balance credit action remains owner-only. Payments are never automatic.</p>
        {!prizeCandidates.length ? <p>No monetary-prize candidates are available until an eligible prize period closes.</p> : prizeCandidates.map((candidate) => {
          const playerId = text(candidate.playerId, "");
          const state = text(candidate.state);
          return <article key={"prize-" + playerId} style={{ border: "1px solid #b8860b", borderRadius: 12, padding: 16, marginBlock: 16 }}>
            <h3>#{text(candidate.effectiveRank)} · {text(candidate.username)}</h3>
            <p>Prize-period weekly total: <strong>{text(candidate.weeklyTotal)}</strong> · State: <strong>{state}</strong></p>
            <Scores value={candidate.scores} />
            {rows(candidate.history).length ? <ul>{rows(candidate.history).map((event, index) => <li key={index}>{text(event.at)} · {text(event.decision)} · {text(event.note)}</li>)}</ul> : null}
            {(state === "pending_review" || state === "needs_additional_review" || state === "approved")
              ? <FlappyPrizeCaseControls week={week} playerId={playerId} state={state} /> : null}
          </article>;
        })}
      </>}
    </section>
  </section>;
}
