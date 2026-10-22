"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { GAMEPLAY_VERSION, RaceToWinAudio, RaceToWinSimulation, TRACK_SEED, type DisplayMetrics, type LaneInputEvent } from "@/lib/game/race-to-win";
import { RaceToWinWorld } from "@/lib/game/race-to-win/world";
import { MidrunHumanCheck } from "./midrun-human-check";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ROUTES } from "@/lib/routes";

type ScreenState = "loading" | "ready" | "starting" | "countdown" | "running" | "finalizing" | "crashed" | "finalize-failed" | "extra-life" | "unavailable";
type OfficialSession = Readonly<{
  sessionId: string;
  seed: number;
  gameplayVersion: string;
  startsAt: string;
  expiresAt: string;
  checkpointInterval: number;
  activityLeaseExpiresAt: string;
}>;
type OfficialOutcome = Readonly<{ score: number; distanceMillimeters: number; elapsedMs: number; collisionAtMs: number }>;
const CHECKPOINT_RETRY_LIMIT = 2;
const EMPTY_METRICS: DisplayMetrics = { score: 0, elapsedSeconds: 0, distanceMeters: 0, speedKph: 97 };

function formatTime(value: number) { return `${Math.floor(value / 60).toString().padStart(2, "0")}:${Math.floor(value % 60).toString().padStart(2, "0")}`; }
function formatDistance(value: number) { return `${Math.floor(value).toLocaleString()} M`; }
async function readJson(response: Response): Promise<unknown> { try { return await response.json(); } catch { return null; } }

function parseOfficialSession(value: unknown): OfficialSession | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  const seed = typeof body.seed === "number" ? body.seed : Number(body.seed);
  if (typeof body.sessionId !== "string" || typeof body.gameplayVersion !== "string" || typeof body.startsAt !== "string" || typeof body.expiresAt !== "string" || typeof body.activityLeaseExpiresAt !== "string" || !Number.isSafeInteger(body.checkpointInterval) || (body.checkpointInterval !== 1_000 && body.checkpointInterval !== 5_000) || !Number.isSafeInteger(seed) || seed < 0 || seed > 0xffff_ffff || !Number.isFinite(Date.parse(body.startsAt)) || !Number.isFinite(Date.parse(body.expiresAt)) || !Number.isFinite(Date.parse(body.activityLeaseExpiresAt))) return null;
  return { sessionId: body.sessionId, seed, gameplayVersion: body.gameplayVersion, startsAt: body.startsAt, expiresAt: body.expiresAt, checkpointInterval: body.checkpointInterval, activityLeaseExpiresAt: body.activityLeaseExpiresAt };
}

function parseOfficialOutcome(value: unknown): OfficialOutcome | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (!Number.isSafeInteger(body.score) || !Number.isSafeInteger(body.distanceMillimeters) || !Number.isSafeInteger(body.elapsedMs) || !Number.isSafeInteger(body.collisionAtMs) || (body.score as number) < 0 || (body.distanceMillimeters as number) < 0 || (body.elapsedMs as number) < 0 || (body.collisionAtMs as number) < 0) return null;
  return { score: body.score as number, distanceMillimeters: body.distanceMillimeters as number, elapsedMs: body.elapsedMs as number, collisionAtMs: body.collisionAtMs as number };
}

export function RaceToWinScene() {
  const router = useRouter();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const simulationRef = useRef<RaceToWinSimulation | null>(null);
  const audioRef = useRef<RaceToWinAudio | null>(null);
  const worldRef = useRef<RaceToWinWorld | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const countdownTimerRef = useRef<number | null>(null);
  const gameOverTimerRef = useRef<number | null>(null);
  const checkpointRetryTimersRef = useRef(new Map<number, number>());
  const checkpointAttemptsRef = useRef(new Map<number, number>());
  const checkpointInFlightRef = useRef(new Set<number>());
  const submitCheckpointRef = useRef<(checkpointIndex: number) => void>(() => undefined);
  const nextCheckpointRef = useRef(1);
  const officialSessionRef = useRef<OfficialSession | null>(null);
  const finalizingRef = useRef(false);
  const screenStateRef = useRef<ScreenState>("loading");
  const humanCheckPausedRef = useRef(false);
  const touchStartRef = useRef<{ x: number; y: number; pointerId: number } | null>(null);
  const [screenState, setScreenState] = useState<ScreenState>("loading");
  const [countdown, setCountdown] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<DisplayMetrics>(EMPTY_METRICS);
  const [officialOutcome, setOfficialOutcome] = useState<OfficialOutcome | null>(null);
  const [runNotice, setRunNotice] = useState<string | null>(null);

  const [opportunities, setOpportunities] = useState<{remaining:number;resetAt:string;exempt:boolean} | null>(null);
  const [opportunitiesError, setOpportunitiesError] = useState(false);
  const refreshOpportunities = useCallback(async () => {
    try {
      const response = await fetch("/api/game-sessions/opportunities", { cache: "no-store", credentials: "same-origin" });
      if (!response.ok) throw new Error("unavailable");
      const data = await response.json() as { remaining: number; resetAt: string; exempt: boolean };
      if (!Number.isInteger(data.remaining) || data.remaining < 0 || data.remaining > 5 || !Number.isFinite(Date.parse(data.resetAt))) throw new Error("invalid");
      setOpportunities({ remaining: data.remaining, resetAt: data.resetAt, exempt: data.exempt === true });
      setOpportunitiesError(false);
    } catch { setOpportunitiesError(true); }
  }, []);
  useEffect(() => {
    void refreshOpportunities();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void refreshOpportunities(); }, 15000);
    const focus = () => { void refreshOpportunities(); };
    window.addEventListener("focus", focus);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", focus); };
  }, [refreshOpportunities]);

  const setState = useCallback((next: ScreenState) => { screenStateRef.current = next; setScreenState(next); }, []);
  const cancelCountdown = useCallback(() => { if (countdownTimerRef.current !== null) { window.clearTimeout(countdownTimerRef.current); countdownTimerRef.current = null; } }, []);
  const cancelGameOverReturn = useCallback(() => { if (gameOverTimerRef.current !== null) { window.clearTimeout(gameOverTimerRef.current); gameOverTimerRef.current = null; } }, []);
  const cancelCheckpointRetries = useCallback(() => { checkpointRetryTimersRef.current.forEach((timer) => window.clearTimeout(timer)); checkpointRetryTimersRef.current.clear(); checkpointAttemptsRef.current.clear(); checkpointInFlightRef.current.clear(); nextCheckpointRef.current = 1; }, []);

  const returnToStartScreen = useCallback(() => {
    cancelCountdown(); cancelCheckpointRetries(); cancelGameOverReturn(); humanCheckPausedRef.current = false; officialSessionRef.current = null; finalizingRef.current = false;
    const simulation = simulationRef.current;
    if (simulation) { simulation.reset(TRACK_SEED); setMetrics(simulation.snapshot().metrics); }
    setCountdown(null); setOfficialOutcome(null); setRunNotice(null); setState("ready");
  }, [cancelCheckpointRetries, cancelCountdown, cancelGameOverReturn, setState]);

  const scheduleGameOverReturn = useCallback(() => {
    cancelGameOverReturn();
    gameOverTimerRef.current = window.setTimeout(() => { gameOverTimerRef.current = null; if (screenStateRef.current === "crashed" || screenStateRef.current === "finalize-failed") returnToStartScreen(); }, 3_000);
  }, [cancelGameOverReturn, returnToStartScreen]);

  const onHumanCheckPauseChange = useCallback((paused: boolean) => { humanCheckPausedRef.current = paused; }, []);
  const getResumeEvidence = useCallback(() => {
    const simulation = simulationRef.current;
    if (!simulation || !humanCheckPausedRef.current) return null;
    return { resumeMs: simulation.snapshot().simulationTimeMs, inputs: simulation.runRecord().inputs };
  }, []);
  const onHumanCheckVerified = useCallback(() => { simulationRef.current?.protectForFiveSeconds(); }, []);
  const requestLaneChange = useCallback((direction: -1 | 1) => { if (screenStateRef.current === "running" && !humanCheckPausedRef.current) simulationRef.current?.requestLaneChange(direction); }, []);

  const submitCheckpoint = useCallback(async (checkpointIndex: number) => {
    const session = officialSessionRef.current;
    const simulation = simulationRef.current;
    if (!session || !simulation || screenStateRef.current !== "running" || checkpointInFlightRef.current.has(checkpointIndex)) return;
    checkpointInFlightRef.current.add(checkpointIndex);
    const inputs: readonly LaneInputEvent[] = simulation.runRecord().inputs;
    try {
      const response = await fetch("/api/game-sessions/checkpoint", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ sessionId: session.sessionId, checkpointIndex, inputs }) });
      const body = response.ok ? await readJson(response) : null;
      if (!body || typeof body !== "object" || (body as { accepted?: unknown }).accepted !== true) throw new Error("checkpoint_rejected");
      nextCheckpointRef.current = Math.max(nextCheckpointRef.current, checkpointIndex + 1);
      checkpointAttemptsRef.current.delete(checkpointIndex);
    } catch {
      const attempts = (checkpointAttemptsRef.current.get(checkpointIndex) ?? 0) + 1;
      checkpointAttemptsRef.current.set(checkpointIndex, attempts);
      if (attempts <= CHECKPOINT_RETRY_LIMIT && screenStateRef.current === "running" && officialSessionRef.current?.sessionId === session.sessionId) {
        const timer = window.setTimeout(() => { checkpointRetryTimersRef.current.delete(checkpointIndex); submitCheckpointRef.current(checkpointIndex); }, attempts * 700);
        checkpointRetryTimersRef.current.set(checkpointIndex, timer);
      } else {
        // Finalization can backfill only milestones the server independently proves.
        nextCheckpointRef.current = Math.max(nextCheckpointRef.current, checkpointIndex + 1);
        setRunNotice("A progress checkpoint could not be confirmed. The server will validate the complete run at the finish.");
      }
    } finally { checkpointInFlightRef.current.delete(checkpointIndex); }
  }, []);

  useEffect(() => {
    submitCheckpointRef.current = (checkpointIndex) => { void submitCheckpoint(checkpointIndex); };
  }, [submitCheckpoint]);

  const submitReachedCheckpoints = useCallback((score: number) => {
    const session = officialSessionRef.current;
    if (!session) return;
    const next = nextCheckpointRef.current;
    if (Math.floor(score / session.checkpointInterval) >= next && !checkpointInFlightRef.current.has(next) && !checkpointRetryTimersRef.current.has(next)) void submitCheckpoint(next);
  }, [submitCheckpoint]);

  const finalizeOfficialRun = useCallback(async () => {
    const session = officialSessionRef.current;
    const simulation = simulationRef.current;
    if (!session || !simulation || finalizingRef.current) return;
    finalizingRef.current = true; cancelCheckpointRetries(); setState("finalizing");
    try {
      // The server treats an identical finalize request as idempotent. Retry only
      // transient network/server failures; never bypass an anti-cheat rejection.
      const payload = JSON.stringify({ sessionId: session.sessionId, inputs: simulation.runRecord().inputs });
      let outcome: OfficialOutcome | null = null;
      let failureStatus: number | null = null;
      let failureRequestId: string | null = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const response = await fetch("/api/game-sessions/finalize", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: payload });
          if (response.ok) {
            outcome = parseOfficialOutcome(await readJson(response));
            break;
          }
          failureStatus = response.status;
          failureRequestId = response.headers.get("X-Request-ID");
          if (![502, 503, 504].includes(response.status)) break;
        } catch {
          failureStatus = null;
        }
      }
      if (!outcome) throw new Error(failureStatus ? `finalize_http_${failureStatus}${failureRequestId ? ` [Ref: ${failureRequestId}]` : ""}` : "finalize_network_or_response");
      // Notify any ranking visible in this tab; server responses remain authoritative.
      window.dispatchEvent(new Event("rtw:score-verified"));
      setOfficialOutcome(outcome); setRunNotice(null); setState("crashed");
    } catch (error) {
      const reason = error instanceof Error ? error.message : "unknown";
      setOfficialOutcome(null); setRunNotice(`No official score was recorded (${reason}). Please check your connection and try another race.`); setState("finalize-failed");
    } finally { finalizingRef.current = false; scheduleGameOverReturn(); }
  }, [cancelCheckpointRetries, scheduleGameOverReturn, setState]);

  const handleHumanCheckTimeout = useCallback(async () => {
    if (screenStateRef.current !== "running" || finalizingRef.current) return;
    const session = officialSessionRef.current;
    const simulation = simulationRef.current;
    if (!session || !simulation) return;
    finalizingRef.current = true;
    setState("finalizing");
    try {
      const response = await fetch("/api/game-sessions/human-check/timeout", {
        method:"POST", credentials:"same-origin", headers:{"Content-Type":"application/json"},
        body:JSON.stringify({sessionId:session.sessionId,inputs:simulation.runRecord().inputs}),
      });
      if (!response.ok) throw new Error("timeout_not_verified");
      const result = await response.json() as {score:number;distanceMillimeters:number;elapsedMs:number};
      if (!Number.isFinite(result.score) || !Number.isFinite(result.elapsedMs) || !Number.isFinite(result.distanceMillimeters)) throw new Error("invalid_timeout_result");
      returnToStartScreen();
      setRunNotice(`Human check timed out. Score: ${result.score.toLocaleString()}. Result saved for verification and tournament review.`);
    } catch {
      returnToStartScreen();
      setRunNotice("Human check timed out. Official score could not be confirmed.");
    } finally {
      finalizingRef.current = false;
    }
  }, [returnToStartScreen,setState]);

  const beginOfficialRun = useCallback(async () => {
    const simulation = simulationRef.current;
    if (!simulation || !worldRef.current || !["ready", "crashed", "finalize-failed"].includes(screenStateRef.current)) return;
    audioRef.current?.unlock(); cancelCountdown(); cancelCheckpointRetries(); cancelGameOverReturn(); setOfficialOutcome(null); setRunNotice(null); setState("starting");
    try {
      const response = await fetch("/api/game-sessions/start", { method: "POST", credentials: "same-origin" });
      if (response.status === 401) { router.push(`${ROUTES.signIn}?next=${encodeURIComponent(ROUTES.raceToWinGame)}`); return; }
      if (response.status === 429) { await refreshOpportunities(); setRunNotice("No official races left this hour. Come back after the hourly reset."); setState("ready"); return; }
      if (response.status === 403) { router.push("/terms/accept"); return; }
      const session = response.ok ? parseOfficialSession(await readJson(response)) : null;
      if (!session || session.gameplayVersion !== GAMEPLAY_VERSION) throw new Error("session_rejected");
      // The database returns started_at as the time the session was created,
      // not a future countdown deadline. By the time HTTP returns it is
      // normally already in the past. Reject expired sessions instead, and
      // schedule the three-second visual countdown on the client.
      const serverStartedAtMs = Date.parse(session.startsAt);
      const expiresAtMs = Date.parse(session.expiresAt);
      if (!Number.isFinite(serverStartedAtMs) || !Number.isFinite(expiresAtMs) || serverStartedAtMs >= expiresAtMs || expiresAtMs <= Date.now() + 3_000) throw new Error("session_timing_rejected");
      void refreshOpportunities();
      const startsAtMs = Date.now() + 3_000;
      officialSessionRef.current = session; nextCheckpointRef.current = 1; simulation.reset(session.seed); setMetrics(simulation.snapshot().metrics); audioRef.current?.play("countdown", { volume: 0.4 }); setState("countdown");
      const tick = () => {
        const remainingMs = startsAtMs - Date.now();
        if (remainingMs <= 0) {
          simulation.start(); setState("running"); setCountdown("GO");
          countdownTimerRef.current = window.setTimeout(() => { countdownTimerRef.current = null; setCountdown(null); }, 350);
          return;
        }
        setCountdown(String(Math.min(3, Math.max(1, Math.ceil(remainingMs / 1_000)))));
        countdownTimerRef.current = window.setTimeout(tick, Math.min(200, remainingMs));
      };
      tick();
    } catch {
      officialSessionRef.current = null; setRunNotice("Official play is unavailable right now. Please try again shortly."); setState("ready");
    }
  }, [cancelCheckpointRetries, cancelCountdown, cancelGameOverReturn, router, setState, refreshOpportunities]);

  const selectExtraLife = useCallback(() => { cancelCountdown(); cancelGameOverReturn(); setState("extra-life"); }, [cancelCountdown, cancelGameOverReturn, setState]);

  useEffect(() => {
    const canvas = canvasRef.current; const stage = stageRef.current;
    if (!canvas || !stage) return;
    let world: RaceToWinWorld;
    try { world = new RaceToWinWorld(canvas); } catch { const frame = window.requestAnimationFrame(() => setState("unavailable")); return () => window.cancelAnimationFrame(frame); }
    const simulation = new RaceToWinSimulation({ seed: TRACK_SEED, trafficVariantCount: 6 });
    audioRef.current = new RaceToWinAudio(); worldRef.current = world; simulationRef.current = simulation;
    const initial = simulation.snapshot(); world.update(initial, 0);
    const initializedFrame = window.requestAnimationFrame(() => { setMetrics(initial.metrics); setState("ready"); });
    const resize = () => { const bounds = stage.getBoundingClientRect(); world.resize(bounds.width, bounds.height); };
    const resizeObserver = new ResizeObserver(resize); resizeObserver.observe(stage); resize();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || screenStateRef.current !== "running" || humanCheckPausedRef.current) return;
      if (event.key === "ArrowLeft" || event.key.toLowerCase() === "a") { event.preventDefault(); requestLaneChange(-1); }
      if (event.key === "ArrowRight" || event.key.toLowerCase() === "d") { event.preventDefault(); requestLaneChange(1); }
    };
    window.addEventListener("keydown", onKeyDown, { passive: false });
    let previousFrameAt = performance.now(); let lastHudUpdateAt = 0;
    const frame = (now: number) => {
      const deltaMs = Math.min(now - previousFrameAt, 100); previousFrameAt = now;
      const snapshot = screenStateRef.current === "running" && !humanCheckPausedRef.current ? simulation.step(deltaMs) : simulation.snapshot();
      world.update(snapshot, deltaMs / 1_000);
      if (now - lastHudUpdateAt >= 90 || snapshot.state === "crashed") { setMetrics(snapshot.metrics); lastHudUpdateAt = now; }
      if (screenStateRef.current === "running" && !humanCheckPausedRef.current) submitReachedCheckpoints(snapshot.metrics.score);
      if (snapshot.state === "crashed" && screenStateRef.current === "running") { audioRef.current?.play("collision", { volume: 0.7 }); void finalizeOfficialRun(); }
      animationFrameRef.current = window.requestAnimationFrame(frame);
    };
    animationFrameRef.current = window.requestAnimationFrame(frame);
    return () => {
      cancelCountdown(); cancelCheckpointRetries(); cancelGameOverReturn(); window.cancelAnimationFrame(initializedFrame);
      if (animationFrameRef.current !== null) window.cancelAnimationFrame(animationFrameRef.current);
      resizeObserver.disconnect(); window.removeEventListener("keydown", onKeyDown); world.dispose(); audioRef.current?.dispose(); audioRef.current = null; simulationRef.current = null; worldRef.current = null;
    };
  }, [cancelCheckpointRetries, cancelCountdown, cancelGameOverReturn, finalizeOfficialRun, requestLaneChange, setState, submitReachedCheckpoints]);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => { if (screenStateRef.current === "running" && event.pointerType === "touch") { touchStartRef.current = { x: event.clientX, y: event.clientY, pointerId: event.pointerId }; event.currentTarget.setPointerCapture(event.pointerId); } };
  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => { const start = touchStartRef.current; touchStartRef.current = null; if (!start || start.pointerId !== event.pointerId || event.pointerType !== "touch") return; const horizontal = event.clientX - start.x; const vertical = event.clientY - start.y; if (Math.abs(horizontal) >= 38 && Math.abs(horizontal) > Math.abs(vertical)) requestLaneChange(horizontal < 0 ? -1 : 1); };
  const officialFinalMetrics = officialOutcome ? { score: officialOutcome.score, elapsedSeconds: officialOutcome.elapsedMs / 1_000, distanceMeters: officialOutcome.distanceMillimeters / 1_000 } : null;

  return <div className={`rtw-stage rtw-stage--${screenState}`} ref={stageRef} onPointerDown={onPointerDown} onPointerUp={onPointerUp} onPointerCancel={() => { touchStartRef.current = null; }}>
    <canvas className="rtw-canvas" ref={canvasRef} aria-label="Race To Win driving scene" /><div className="rtw-vignette" aria-hidden="true" />
    <MidrunHumanCheck sessionId={officialSessionRef.current?.sessionId ?? null} running={screenState === "running"} onPauseChange={onHumanCheckPauseChange} onTimeout={handleHumanCheckTimeout} getResumeEvidence={getResumeEvidence} onVerified={onHumanCheckVerified} />
    {screenState === "running" ? <div className="rtw-hud" aria-label="Local display metrics; official result is validated by the server"><div><span>SCORE</span><strong>{metrics.score.toLocaleString()}</strong></div><div><span>TIME</span><strong>{formatTime(metrics.elapsedSeconds)}</strong></div></div> : null}
    {screenState === "ready" ? <div className="rtw-overlay rtw-overlay--ready"><p className="rtw-kicker">OFFICIAL SESSION</p><h3>RACE TO WIN</h3><p>DODGE TRAFFIC. SURVIVE. GO FARTHER.</p><div className="rtw-menu-actions"><div className="rtw-play-wrap"><button type="button" className="rtw-action rtw-action--primary rtw-action--play-glass" disabled={opportunitiesError || !opportunities || (opportunities.remaining === 0 && !opportunities.exempt)} onClick={() => void beginOfficialRun()}>PLAY</button><span className="rtw-play-count" aria-live="polite" aria-label={opportunities?.exempt ? "Test account with unlimited races" : opportunities ? `${opportunities.remaining} of 5 races remaining` : "Checking races remaining"}><span className="rtw-play-count__ticket" aria-hidden="true">◉</span>{opportunitiesError ? "—/5" : opportunities ? (opportunities.exempt ? "∞" : `${opportunities.remaining}/5`) : "…/5"}</span></div><Link className="rtw-action rtw-action--placeholder" href={ROUTES.scores}>SCORES</Link></div><div className="rtw-ad-slot"><button className="rtw-opportunities__ad" type="button" disabled title="Rewarded ads are not connected yet">▶ WATCH AD · +1 RACE <small>COMING SOON</small></button></div>{runNotice ? <p className="rtw-run-notice" role="status">{runNotice}</p> : null}<div className="rtw-control-hints" aria-label="Game controls"><span><b>DESKTOP</b> A / D OR ARROW KEYS</span><span><b>MOBILE</b> SWIPE TO CHANGE LANES</span></div></div> : null}
    {screenState === "starting" ? <div className="rtw-loading" role="status">PREPARING OFFICIAL SESSION…</div> : null}
    {(screenState === "countdown" || (screenState === "running" && countdown === "GO")) && countdown ? <div className="rtw-countdown" aria-live="assertive">{countdown}</div> : null}
    {screenState === "finalizing" ? <div className="rtw-loading" role="status">VALIDATING RUN…</div> : null}
    {screenState === "crashed" ? <div className="rtw-overlay rtw-overlay--game-over" role="status"><p className="rtw-kicker">OFFICIAL RESULT</p><h3>GAME OVER</h3>{officialFinalMetrics ? <dl className="rtw-final-stats"><div><dt>OFFICIAL SCORE</dt><dd>{officialFinalMetrics.score.toLocaleString()}</dd></div><div><dt>TIME</dt><dd>{formatTime(officialFinalMetrics.elapsedSeconds)}</dd></div><div><dt>DISTANCE</dt><dd>{formatDistance(officialFinalMetrics.distanceMeters)}</dd></div></dl> : null}<div className="rtw-game-over-actions"><button type="button" className="rtw-action rtw-action--primary" onClick={() => void beginOfficialRun()}>PLAY AGAIN</button><button type="button" className="rtw-action rtw-action--placeholder" onClick={selectExtraLife}>EXTRA LIFE <small>COMING SOON</small></button></div></div> : null}
    {screenState === "finalize-failed" ? <div className="rtw-overlay rtw-overlay--game-over" role="status"><p className="rtw-kicker">RUN NOT VALIDATED</p><h3>GAME OVER</h3><p>{runNotice}</p><button type="button" className="rtw-action rtw-action--primary" onClick={returnToStartScreen}>RETURN TO START</button></div> : null}
    {screenState === "extra-life" ? <div className="rtw-overlay rtw-overlay--game-over" role="status"><p className="rtw-kicker">EXTRA LIFE</p><h3>COMING SOON</h3><p>Extra Life is reserved for a future authoritative reward flow. No local reward has been granted.</p><button type="button" className="rtw-action rtw-action--primary" onClick={returnToStartScreen}>RETURN TO START</button></div> : null}
    {screenState === "loading" ? <div className="rtw-loading" role="status">LOADING TRACK…</div> : null}
    {screenState === "unavailable" ? <div className="rtw-overlay rtw-overlay--unavailable" role="status"><h3>TRACK UNAVAILABLE</h3><p>This browser could not start the racing scene. Please try a current browser with hardware acceleration enabled.</p></div> : null}
  </div>;
}
