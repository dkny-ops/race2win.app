"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { claimGuestTrial, guestTrialUsed } from "@/lib/game/guest-trial";

type Pipe = { x: number; gap: number; passed: boolean };
const W = 360, H = 480, BIRD_X = 82, GAP = 150, PIPE_W = 54;
export function FlappyMini({ language, authenticated = false }: { language: "en" | "es"; authenticated?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [expanded, setExpanded] = useState(false);
  const game = useRef({ y: 220, vy: 0, pipes: [] as Pipe[], score: 0, running: false, over: false, frame: 0 });
  const [status, setStatus] = useState<"ready" | "running" | "over">("ready");
  const [score, setScore] = useState(0);
  const [guestBlocked, setGuestBlocked] = useState(false);
  useEffect(() => { if (!authenticated) setGuestBlocked(guestTrialUsed()); }, [authenticated]);
  const [countdown, setCountdown] = useState<number | null>(null);
  const countdownTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const flap = useCallback(() => {
    const g = game.current;
    if (!g.running || g.over) return;
    g.vy = -5.5;
  }, []);
  const startGame = useCallback(() => {
    if (countdownTimer.current !== null || game.current.running) return;
    if (!authenticated && !claimGuestTrial()) { setGuestBlocked(true); return; }
    setExpanded(true);
    if (countdownTimer.current !== null) clearInterval(countdownTimer.current);
    Object.assign(game.current, { y: 220, vy: 0, pipes: [], score: 0, running: false, over: false, frame: 0 });
    setScore(0); setStatus("ready"); setCountdown(3);
    let remaining = 3;
    countdownTimer.current = setInterval(() => {
      remaining -= 1;
      if (remaining === 0) {
        if (countdownTimer.current !== null) clearInterval(countdownTimer.current);
        countdownTimer.current = null;
        setCountdown(null);
        game.current.running = true;
        setStatus("running");
      } else setCountdown(remaining);
    }, 1000);
  }, [authenticated]);
  useEffect(() => () => { if (countdownTimer.current !== null) clearInterval(countdownTimer.current); }, []);
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.code === "Space" && document.activeElement === canvasRef.current) { event.preventDefault(); flap(); } };
    window.addEventListener("keydown", key);
    const canvas = canvasRef.current, ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return () => window.removeEventListener("keydown", key);
    let raf = 0, last = 0;
    function draw(time: number) {
      if (!ctx) return;
      const g = game.current;
      const dt = Math.min(2, (time - (last || time)) / (1000 / 60)); last = time;
      if (g.running && !g.over) {
        g.frame += dt; g.vy += 0.29 * dt; g.y += g.vy * dt;
        if (g.frame > 95 && (g.pipes.length === 0 || g.pipes[g.pipes.length - 1].x < W - 175)) g.pipes.push({ x: W + 5, gap: 105 + Math.random() * 205, passed: false });
        for (const p of g.pipes) {
          p.x -= 2.15 * dt;
          if (!p.passed && p.x + PIPE_W < BIRD_X) { p.passed = true; g.score++; setScore(g.score); }
          if (BIRD_X + 13 > p.x && BIRD_X - 13 < p.x + PIPE_W && (g.y - 13 < p.gap - GAP / 2 || g.y + 13 > p.gap + GAP / 2)) g.over = true;
        }
        g.pipes = g.pipes.filter(p => p.x > -PIPE_W);
        if (g.y < 13 || g.y > H - 36) g.over = true;
        if (g.over) { g.running = false; setStatus("over"); }
      }
      ctx.fillStyle = "#071a2c"; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "#0d3550";
      for (let i = 0; i < 12; i++) ctx.fillRect(i * 37, H - 95 - (i * 29 % 85), 25, 95 + (i * 29 % 85));
      for (const p of g.pipes) {
        ctx.fillStyle = "#22d3ee";
        ctx.fillRect(p.x, 0, PIPE_W, p.gap - GAP / 2);
        ctx.fillRect(p.x, p.gap + GAP / 2, PIPE_W, H);
      }
      ctx.fillStyle = "#eab308"; ctx.beginPath(); ctx.arc(BIRD_X, g.y, 13, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#111827"; ctx.beginPath(); ctx.arc(BIRD_X + 5, g.y - 4, 2.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#182d3c"; ctx.fillRect(0, H - 23, W, 23);
      raf = requestAnimationFrame(draw);
    }
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("keydown", key); };
  }, [flap]);
  return <div style={{ textAlign: "center" }}>
    <p style={{ marginBottom: 12 }}>{language === "es" ? "Toca para volar. Evita los obstáculos." : "Tap to fly. Dodge the obstacles."}</p>
    <div style={expanded ? { position: "fixed", inset: 0, zIndex: 9999, background: "#071a2c", width: "100vw", height: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" } : { position: "relative", maxWidth: 360, margin: "auto" }}>
      <canvas ref={canvasRef} width={W} height={H} tabIndex={0} aria-label="Flappy mini game" onPointerDown={flap} style={expanded ? { display: "block", width: "100%", height: "100%", objectFit: "contain", touchAction: "none", cursor: "pointer" } : { display: "block", width: "100%", maxWidth: 360, height: "auto", margin: "auto", border: "1px solid #23617c", borderRadius: 12, touchAction: "manipulation", cursor: "pointer" }} />
      {!expanded && status === "ready" && countdown === null && !guestBlocked ? <button type="button" onClick={startGame} aria-label={language === "es" ? "Jugar" : "Play"} style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", borderRadius: 999, border: "2px solid #67e8f9", background: "#0865d8", color: "white", padding: "1rem 2rem", fontSize: "1.3rem", fontWeight: 900, cursor: "pointer", boxShadow: "0 0 30px #0369a1" }}>▶ PLAY</button> : null}
      {countdown !== null ? <div aria-live="assertive" style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", fontSize: "5rem", fontWeight: 900, color: "#fff", textShadow: "0 3px 12px #000", pointerEvents: "none" }}>{countdown}</div> : null}
      {expanded && status === "running" ? <div style={{ position: "absolute", top: "max(1rem, env(safe-area-inset-top))", left: 16, padding: "0.5rem 1rem", color: "white", background: "#071a2ccc", borderRadius: 12, pointerEvents: "none", fontWeight: 800 }}>SCORE: {score}</div> : null}
      {expanded && status === "over" ? <div role="status" style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, background: "#06121de8", color: "white", padding: 20 }}><h2>GAME OVER</h2><p>SCORE: {score}</p>{!authenticated ? <><p style={{ maxWidth: 300 }}>{language === "es" ? "La prueba no cuenta para torneos ni premios." : "Guest play does not count for tournaments or prizes."}</p><Link className="button button--primary" href="/sign-in?next=%2Fgames%2Fflappy-race">SIGN IN</Link></> : <button type="button" className="button button--primary" onClick={() => { setExpanded(false); startGame(); }}>PLAY AGAIN</button>}<button type="button" className="button button--secondary" onClick={() => setExpanded(false)}>{language === "es" ? "SALIR" : "EXIT"}</button></div> : null}
    </div>
    <p style={{ marginTop: 12 }}>{language === "es" ? "Puntos" : "Score"}: <strong>{score}</strong> · {status === "over" ? (language === "es" ? "Fin de partida" : "Game over") : status === "ready" ? (language === "es" ? "Preparado" : "Ready") : (language === "es" ? "Jugando" : "Playing")}</p>
    {!authenticated && (guestBlocked || status === "over") ? <p role="status" style={{ marginTop: 12 }}>{language === "es" ? "La prueba gratuita no participa en torneos ni genera premios. Inicia sesión para continuar." : "Guest play does not count for tournaments or prizes. Sign in to continue."} <Link href="/sign-in?next=%2Fgames%2Fflappy-race" className="button button--primary" style={{ marginTop: 10 }}>SIGN IN</Link></p> : null}

    <p style={{ marginTop: 10, opacity: 0.75, fontSize: "0.85rem" }}>{language === "es" ? "Demo sin premios ni clasificación." : "Demo without prizes or leaderboard."}</p>
  </div>;
}
