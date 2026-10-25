"use client";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { FlappyRewardOptions } from "./flappy-reward-options";
import { initialFlappy, stepFlappy, MAX_TICKS, MAX_INPUTS, MIN_FLAP_TICKS, type FlappyState } from "@/lib/game/flappy/engine";
import { FLAPPY_COMPETITION_ENABLED } from "@/lib/game/flappy/activation";
import { startFlappyOfficial, checkpointFlappyOfficial, finalizeFlappyOfficial, type FlappySession, type FlappyResult } from "@/lib/game/flappy/official-client";
import { claimGuestTrial, guestTrialUsed } from "@/lib/game/guest-trial";

function subscribeGuestTrial(notify: () => void) {
  window.addEventListener("storage", notify);
  return () => window.removeEventListener("storage", notify);
}
const unusedGuestTrialOnServer = () => false;

type Status = "ready" | "starting" | "running" | "validating" | "over" | "rejected";
export function FlappyVerifiedCanvas({ language, authenticated }: { language: "en" | "es"; authenticated: boolean }) {
  const es = language === "es";
  const canvas = useRef<HTMLCanvasElement>(null);
  const engine = useRef<FlappyState>(initialFlappy(0));
  const inputs = useRef<number[]>([]);
  const official = useRef<FlappySession | null>(null);
  const running = useRef(false), busy = useRef(false), origin = useRef(0), nextCheckpoint = useRef(300);
  const pendingFlap = useRef(false), mounted = useRef(true), lastFrame = useRef(0);
  const [status, setStatus] = useState<Status>("ready");
  const [score, setScore] = useState(0);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [rewardExpanded, setRewardExpanded] = useState(false);
  const [result, setResult] = useState<FlappyResult | null>(null);
  const [guestBlocked, setGuestBlocked] = useState(false);
  const guestConsumed = useSyncExternalStore(subscribeGuestTrial, guestTrialUsed, unusedGuestTrialOnServer);
  const [mode, setMode] = useState<"practice" | "official">("practice");
  const fail = useCallback(() => { running.current = false; if (mounted.current) { setResult(null); setStatus("rejected"); } }, []);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; running.current = false; }; }, [authenticated]);
  const flap = useCallback(() => { if (running.current && performance.now() >= origin.current) pendingFlap.current = true; }, []);
  const start = useCallback(async () => {
    if (busy.current || running.current) return;
    if (!authenticated && !claimGuestTrial()) { setGuestBlocked(true); return; }
    busy.current = true;
    setRewardExpanded(false); setStatus("starting"); setResult(null); setScore(0);
    try {
      const session = mode === "official" ? await startFlappyOfficial() : null;
      if (!mounted.current) return;
      official.current = session;
      // Practice randomness is explicitly non-authoritative.
      const seed = session?.seed ?? crypto.getRandomValues(new Uint32Array(1))[0];
      engine.current = initialFlappy(seed); inputs.current = []; pendingFlap.current = false;
      nextCheckpoint.current = 300;
      origin.current = session ? performance.now() + (Date.parse(session.startsAt) - Date.now()) : performance.now() + 3000;
      if (origin.current <= performance.now()) throw new Error("Start schedule missed");
      setExpanded(true); setCountdown(Math.ceil((origin.current - performance.now()) / 1000));
      canvas.current?.focus({ preventScroll: true });
      running.current = true; lastFrame.current = performance.now(); setStatus("running");
    } catch { fail(); }
    finally { busy.current = false; }
  }, [authenticated, mode, fail]);

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.code === "Space" && document.activeElement === canvas.current) { event.preventDefault(); flap(); }
    };
    window.addEventListener("keydown", key);
    let raf = 0;
    async function submitFinal() {
      if (busy.current || !official.current) { fail(); return; }
      busy.current = true; setStatus("validating");
      try {
        const verified = await finalizeFlappyOfficial(official.current, engine.current, inputs.current);
        if (mounted.current) { setResult(verified); setStatus("over"); }
      } catch { fail(); }
      finally { busy.current = false; }
    }
    async function checkpoint() {
      if (busy.current || !official.current) return;
      busy.current = true;
      // Freeze this evidence snapshot while rendering continues.
      const snapshot = { ...engine.current, pipes: engine.current.pipes.map(p => ({ ...p })) };
      const evidence = inputs.current.slice();
      try { await checkpointFlappyOfficial(official.current, snapshot, evidence); }
      catch { fail(); }
      finally { busy.current = false; }
    }
    function draw(time: number) {
      const ctx = canvas.current?.getContext("2d"), g = engine.current;
      if (running.current) {
        const untilStart = origin.current - time;
        if (untilStart > 0) setCountdown(Math.ceil(untilStart / 1000));
        else {
          setCountdown(null);
          // Losing seconds of official activity is a safe rejection, never a
          // browser-driven fast-forward. Practice can resume at its own pace.
          if (official.current && time - lastFrame.current > 2000) fail();
          const target = Math.min(MAX_TICKS, Math.floor((time - origin.current) * 60 / 1000));
          const budget = Math.min(target - g.tick, 120);
          for (let n = 0; n < budget && running.current && !g.dead; n++) {
            const previous = inputs.current.at(-1) ?? -MIN_FLAP_TICKS;
            const apply = pendingFlap.current && g.tick - previous >= MIN_FLAP_TICKS;
            if (apply) { inputs.current.push(g.tick); pendingFlap.current = false; }
            if (inputs.current.length > MAX_INPUTS) { fail(); break; }
            stepFlappy(g, apply);
          }
          setScore(g.score);
          if (g.dead && running.current) {
            running.current = false;
            if (official.current) {
              // Wait for any earlier checkpoint before finalizing its prefix.
              if (busy.current) setStatus("validating");
              else void submitFinal();
            } else setStatus("over");
          } else if (g.tick >= MAX_TICKS) fail();
          else if (official.current && g.tick >= nextCheckpoint.current && !busy.current) {
            nextCheckpoint.current = g.tick + 300; void checkpoint();
          }
        }
        lastFrame.current = time;
      }
      if (ctx) {
        ctx.fillStyle = "#071a2c"; ctx.fillRect(0,0,360,480);
        ctx.fillStyle = "#0d3550";
        for(let i=0;i<12;i++) ctx.fillRect(i*37,480-95-(i*29%85),25,95+(i*29%85));
        for(const p of g.pipes) {
          ctx.fillStyle="#22d3ee";ctx.fillRect(p.x/100,0,54,(p.gap-7500)/100);
          ctx.fillRect(p.x/100,(p.gap+7500)/100,54,480);
        }
        ctx.fillStyle="#eab308";ctx.beginPath();ctx.arc(82,g.y/100,13,0,Math.PI*2);ctx.fill();
        ctx.fillStyle="#111827";ctx.beginPath();ctx.arc(87,g.y/100-4,2.5,0,Math.PI*2);ctx.fill();
        ctx.fillStyle="#182d3c";ctx.fillRect(0,457,360,23);
      }
      raf=requestAnimationFrame(draw);
    }
    raf=requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("keydown",key); };
  }, [flap, fail]);
  // A collision may occur while its prior checkpoint is in flight. Finish only
  // after that request settles; never send concurrent mutation requests.
  useEffect(() => {
    if (status !== "validating" || !official.current || result) return;
    let active = true;
    const timer = window.setInterval(async () => {
      if (busy.current || !active || !official.current) return;
      busy.current=true; window.clearInterval(timer);
      try { const verified=await finalizeFlappyOfficial(official.current,engine.current,inputs.current);
        if(active) {setResult(verified);setStatus("over");}
      } catch { if(active) fail(); } finally {busy.current=false;}
    },100);
    return () => {active=false;window.clearInterval(timer);};
  },[status,result,fail]);
  useEffect(() => {
    if (!["over","rejected"].includes(status) || rewardExpanded) return;
    const timer = window.setTimeout(() => {
      running.current=false; official.current=null; pendingFlap.current=false;
      engine.current=initialFlappy(0); inputs.current=[];
      setExpanded(false);setScore(0);setCountdown(null);setResult(null);setStatus("ready");
      if (!authenticated) setGuestBlocked(guestTrialUsed());
    },5000);
    return () => window.clearTimeout(timer);
  },[status,authenticated,rewardExpanded]);
  const terminal = status === "over" || status === "rejected";
  return <div style={{textAlign:"center"}}>
    <p>{es ? "Toca o pulsa ESPACIO para volar. Evita los obstáculos." : "Tap or press SPACE to fly. Dodge the obstacles."}</p>
    {FLAPPY_COMPETITION_ENABLED && authenticated ? <label>{es ? "Modo" : "Mode"} <select value={mode} disabled={["starting", "running", "validating"].includes(status)} onChange={event => setMode(event.target.value === "official" ? "official" : "practice")}><option value="practice">{es ? "Práctica" : "Practice"}</option><option value="official">{es ? "Competición" : "Competition"}</option></select></label> : null}
    <div style={expanded ? {position:"fixed",inset:0,zIndex:9999,background:"#071a2c",width:"100vw",height:"100dvh",display:"flex",alignItems:"center",justifyContent:"center",overflow:"hidden"} : {position:"relative",maxWidth:360,margin:"auto"}}>
      <canvas ref={canvas} width={360} height={480} tabIndex={0} aria-label="Flappy mini game" onPointerDown={() => { canvas.current?.focus({ preventScroll: true }); flap(); }} style={expanded ? {display:"block",width:"100%",height:"100%",objectFit:"contain",touchAction:"none"} : {display:"block",width:"100%",height:"auto",border:"1px solid #23617c",borderRadius:12,touchAction:"manipulation"}} />
      {!expanded ? ((!guestBlocked && !guestConsumed) || authenticated ? <button className="button button--primary" type="button" onClick={() => {void start();}} disabled={status==="starting"} style={{position:"absolute",top:"50%",left:"50%",transform:"translate(-50%,-50%)",borderRadius:999,border:"2px solid #67e8f9",background:"#0865d8",color:"white",padding:"1rem 2rem",fontSize:"1.3rem",fontWeight:900,cursor:"pointer",boxShadow:"0 0 30px #0369a1"}}>{status==="starting" ? "…" : "▶ PLAY"}</button> : <Link className="button button--primary" href="/sign-in?next=%2Fgames%2Fflappy-race" style={{position:"absolute",top:"50%",left:"50%",transform:"translate(-50%,-50%)"}}>SIGN IN TO PLAY</Link>) : null}
      {expanded && countdown!==null ? <div aria-live="assertive" style={{position:"absolute",fontSize:"5rem",fontWeight:900,pointerEvents:"none"}}>{countdown}</div> : null}
      {expanded && status==="running" && countdown===null ? <div style={{position:"absolute",top:"max(1rem, env(safe-area-inset-top))",left:16,padding:".5rem 1rem",background:"#071a2ccc",borderRadius:12,pointerEvents:"none",fontWeight:800}}>SCORE: {score}</div> : null}
      {expanded && (terminal || status==="validating") ? <div role="status" style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",gap:16,background:"#06121de8",padding:20,overflowY:"auto",justifyContent:"safe center"}}>
        <h2>{status==="validating" ? (es ? "VALIDANDO…" : "VALIDATING…") : "GAME OVER"}</h2>
        <p>{result ? (es ? "Verificado por servidor" : "Server verified") + ": " + result.score : mode==="practice" ? "SCORE: "+score : (es ? "Sin resultado oficial" : "No official result")}</p>
        {result ? <p>{es ? "Pendiente de revisión antifraude. Aún no cuenta para el ranking." : "Pending antifraud review. Not included in ranking yet."}</p> : null}
        {status==="rejected" ? <p>{es ? "La partida no se ha añadido al ranking." : "This run was not added to the ranking."}</p> : null}
        {terminal ? <FlappyRewardOptions es={es} onOpenChange={setRewardExpanded} /> : null}
        {terminal && authenticated ? <button className="button button--primary" type="button" onClick={() => {void start();}}>PLAY AGAIN</button> : null}
        {terminal && !authenticated ? <Link className="button button--primary" href="/sign-in?next=%2Fgames%2Fflappy-race">SIGN IN</Link> : null}
      </div> : null}
    </div>
    <FlappyRewardOptions es={es} />
    <p style={{marginTop:12}}>{es ? "Puntos de práctica / en curso" : "Practice / in-progress score"}: <strong>{score}</strong></p>
    <p className="muted">{es ? "Modo práctica. Las puntuaciones no cuentan para el ranking ni generan premios." : "Practice mode. Scores do not count toward the ranking or prizes."}</p>
  </div>;
}
