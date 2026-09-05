"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  RaceToWinAudio,
  RaceToWinSimulation,
  TRACK_SEED,
  type DisplayMetrics,
} from "@/lib/game/race-to-win";
import { RaceToWinWorld } from "@/lib/game/race-to-win/world";

type ScreenState = "loading" | "ready" | "countdown" | "running" | "crashed" | "extra-life" | "unavailable";

const EMPTY_METRICS: DisplayMetrics = {
  score: 0,
  elapsedSeconds: 0,
  distanceMeters: 0,
  speedKph: 97,
};

function formatTime(elapsedSeconds: number): string {
  const minutes = Math.floor(elapsedSeconds / 60).toString().padStart(2, "0");
  const seconds = Math.floor(elapsedSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function formatDistance(distanceMeters: number): string {
  return `${Math.floor(distanceMeters).toLocaleString()} M`;
}

export function RaceToWinScene() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const simulationRef = useRef<RaceToWinSimulation | null>(null);
  const audioRef = useRef<RaceToWinAudio | null>(null);
  const worldRef = useRef<RaceToWinWorld | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const countdownTimerRef = useRef<number | null>(null);
  const gameOverTimerRef = useRef<number | null>(null);
  const screenStateRef = useRef<ScreenState>("loading");
  const touchStartRef = useRef<{ x: number; y: number; pointerId: number } | null>(null);
  const [screenState, setScreenState] = useState<ScreenState>("loading");
  const [countdown, setCountdown] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<DisplayMetrics>(EMPTY_METRICS);

  const setState = useCallback((nextState: ScreenState) => {
    screenStateRef.current = nextState;
    setScreenState(nextState);
  }, []);

  const cancelCountdown = useCallback(() => {
    if (countdownTimerRef.current !== null) {
      window.clearTimeout(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
  }, []);

  const cancelGameOverReturn = useCallback(() => {
    if (gameOverTimerRef.current !== null) {
      window.clearTimeout(gameOverTimerRef.current);
      gameOverTimerRef.current = null;
    }
  }, []);

  const returnToStartScreen = useCallback(() => {
    cancelCountdown();
    cancelGameOverReturn();
    const simulation = simulationRef.current;
    if (simulation) {
      simulation.reset(TRACK_SEED);
      setMetrics(simulation.snapshot().metrics);
    }
    setCountdown(null);
    setState("ready");
  }, [cancelCountdown, cancelGameOverReturn, setState]);

  const scheduleGameOverReturn = useCallback(() => {
    cancelGameOverReturn();
    gameOverTimerRef.current = window.setTimeout(() => {
      gameOverTimerRef.current = null;
      if (screenStateRef.current === "crashed") returnToStartScreen();
    }, 3_000);
  }, [cancelGameOverReturn, returnToStartScreen]);

  const requestLaneChange = useCallback((direction: -1 | 1) => {
    if (screenStateRef.current !== "running") return;
    simulationRef.current?.requestLaneChange(direction);
  }, []);

  const beginCountdown = useCallback((): boolean => {
    const simulation = simulationRef.current;
    if (!simulation || !worldRef.current) return false;

    audioRef.current?.unlock();
    audioRef.current?.play("countdown", { volume: 0.4 });
    cancelCountdown();
    cancelGameOverReturn();
    simulation.reset(TRACK_SEED);
    setMetrics(simulation.snapshot().metrics);
    setState("countdown");

    const stages = ["3", "2", "1", "GO"] as const;
    const advance = (stageIndex: number) => {
      setCountdown(stages[stageIndex]!);
      countdownTimerRef.current = window.setTimeout(() => {
        if (stageIndex === stages.length - 1) {
          simulation.start();
          setCountdown(null);
          setState("running");
          countdownTimerRef.current = null;
          return;
        }
        advance(stageIndex + 1);
      }, stageIndex === stages.length - 1 ? 480 : 760);
    };
    advance(0);
    return true;
  }, [cancelCountdown, cancelGameOverReturn, setState]);

  const selectExtraLife = useCallback(() => {
    // This deliberately opens only a local placeholder. No reward, score, or
    // player entitlement is created until an authoritative server flow exists.
    cancelCountdown();
    cancelGameOverReturn();
    setState("extra-life");
  }, [cancelCountdown, cancelGameOverReturn, setState]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    if (!canvas || !stage) return;

    let world: RaceToWinWorld;
    try {
      world = new RaceToWinWorld(canvas);
    } catch {
      const nextPaint = window.requestAnimationFrame(() => setState("unavailable"));
      return () => window.cancelAnimationFrame(nextPaint);
    }

    const simulation = new RaceToWinSimulation({ seed: TRACK_SEED, trafficVariantCount: 6 });
    audioRef.current = new RaceToWinAudio();
    worldRef.current = world;
    simulationRef.current = simulation;
    const initialSnapshot = simulation.snapshot();
    world.update(initialSnapshot, 0);
    const initializedFrame = window.requestAnimationFrame(() => {
      setMetrics(initialSnapshot.metrics);
      setState("ready");
    });

    const resize = () => {
      const bounds = stage.getBoundingClientRect();
      world.resize(bounds.width, bounds.height);
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(stage);
    resize();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || screenStateRef.current !== "running") return;
      if (event.key === "ArrowLeft" || event.key.toLowerCase() === "a") {
        event.preventDefault();
        requestLaneChange(-1);
      }
      if (event.key === "ArrowRight" || event.key.toLowerCase() === "d") {
        event.preventDefault();
        requestLaneChange(1);
      }
    };
    window.addEventListener("keydown", onKeyDown, { passive: false });

    let previousFrameAt = performance.now();
    let lastHudUpdateAt = 0;
    const frame = (now: number) => {
      const deltaMs = Math.min(now - previousFrameAt, 100);
      previousFrameAt = now;
      const snapshot = screenStateRef.current === "running"
        ? simulation.step(deltaMs)
        : simulation.snapshot();
      world.update(snapshot, deltaMs / 1000);

      if (now - lastHudUpdateAt >= 90 || snapshot.state === "crashed") {
        setMetrics(snapshot.metrics);
        lastHudUpdateAt = now;
      }
      if (snapshot.state === "crashed" && screenStateRef.current === "running") {
        audioRef.current?.play("collision", { volume: 0.7 });
        setState("crashed");
        scheduleGameOverReturn();
      }
      animationFrameRef.current = window.requestAnimationFrame(frame);
    };
    animationFrameRef.current = window.requestAnimationFrame(frame);

    return () => {
      cancelCountdown();
      cancelGameOverReturn();
      window.cancelAnimationFrame(initializedFrame);
      if (animationFrameRef.current !== null) window.cancelAnimationFrame(animationFrameRef.current);
      resizeObserver.disconnect();
      window.removeEventListener("keydown", onKeyDown);
      world.dispose();
      audioRef.current?.dispose();
      audioRef.current = null;
      simulationRef.current = null;
      worldRef.current = null;
    };
  }, [cancelCountdown, cancelGameOverReturn, requestLaneChange, scheduleGameOverReturn, setState]);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (screenStateRef.current !== "running" || event.pointerType !== "touch") return;
    touchStartRef.current = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = touchStartRef.current;
    touchStartRef.current = null;
    if (!start || start.pointerId !== event.pointerId || event.pointerType !== "touch") return;
    const horizontalTravel = event.clientX - start.x;
    const verticalTravel = event.clientY - start.y;
    if (Math.abs(horizontalTravel) < 38 || Math.abs(horizontalTravel) <= Math.abs(verticalTravel)) return;
    requestLaneChange(horizontalTravel < 0 ? -1 : 1);
  };

  const onPointerCancel = () => {
    touchStartRef.current = null;
  };

  return (
    <div
      className={`rtw-stage rtw-stage--${screenState}`}
      ref={stageRef}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      <canvas className="rtw-canvas" ref={canvasRef} aria-label="Race To Win driving scene" />
      <div className="rtw-vignette" aria-hidden="true" />

      {screenState === "running" ? (
        <div className="rtw-hud" aria-label="Local game metrics">
          <div><span>SCORE</span><strong>{metrics.score.toLocaleString()}</strong></div>
          <div><span>TIME</span><strong>{formatTime(metrics.elapsedSeconds)}</strong></div>
          <div><span>DISTANCE</span><strong>{formatDistance(metrics.distanceMeters)}</strong></div>
          <div><span>SPEED</span><strong>{Math.round(metrics.speedKph)} <small>KPH</small></strong></div>
        </div>
      ) : null}

      {screenState === "ready" ? (
        <div className="rtw-overlay rtw-overlay--ready">
          <p className="rtw-kicker">LOCAL PLAYTEST</p>
          <h3>RACE TO WIN</h3>
          <p>DODGE TRAFFIC. SURVIVE. GO FARTHER.</p>
          <div className="rtw-menu-actions">
            <button type="button" className="rtw-action rtw-action--primary" onClick={beginCountdown}>PLAY</button>
            <button type="button" className="rtw-action rtw-action--placeholder" disabled title="Scores are not available in this phase">SCORES <small>COMING SOON</small></button>
          </div>
          <div className="rtw-control-hints" aria-label="Game controls">
            <span><b>DESKTOP</b> A / D OR ARROW KEYS</span>
            <span><b>MOBILE</b> SWIPE TO CHANGE LANES</span>
          </div>
        </div>
      ) : null}

      {screenState === "countdown" && countdown ? (
        <div className="rtw-countdown" aria-live="assertive">{countdown}</div>
      ) : null}

      {screenState === "crashed" ? (
        <div className="rtw-overlay rtw-overlay--game-over" role="status">
          <p className="rtw-kicker">RUN COMPLETE</p>
          <h3>GAME OVER</h3>
          <dl className="rtw-final-stats">
            <div><dt>SCORE</dt><dd>{metrics.score.toLocaleString()}</dd></div>
            <div><dt>TIME</dt><dd>{formatTime(metrics.elapsedSeconds)}</dd></div>
            <div><dt>DISTANCE</dt><dd>{formatDistance(metrics.distanceMeters)}</dd></div>
          </dl>
          <div className="rtw-game-over-actions">
            <button type="button" className="rtw-action rtw-action--primary" onClick={beginCountdown}>PLAY AGAIN</button>
            <button type="button" className="rtw-action rtw-action--placeholder" onClick={selectExtraLife}>EXTRA LIFE <small>COMING SOON</small></button>
          </div>
        </div>
      ) : null}

      {screenState === "extra-life" ? (
        <div className="rtw-overlay rtw-overlay--game-over" role="status">
          <p className="rtw-kicker">EXTRA LIFE</p>
          <h3>COMING SOON</h3>
          <p>Extra Life is reserved for a future authoritative reward flow. No local reward has been granted.</p>
          <button type="button" className="rtw-action rtw-action--primary" onClick={returnToStartScreen}>RETURN TO START</button>
        </div>
      ) : null}

      {screenState === "loading" ? <div className="rtw-loading" role="status">LOADING TRACK…</div> : null}
      {screenState === "unavailable" ? (
        <div className="rtw-overlay rtw-overlay--unavailable" role="status">
          <h3>TRACK UNAVAILABLE</h3>
          <p>This browser could not start the local racing scene. Please try a current browser with hardware acceleration enabled.</p>
        </div>
      ) : null}
    </div>
  );
}
