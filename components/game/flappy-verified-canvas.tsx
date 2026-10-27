"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ShareGameButton } from "./share-game-button";
import { AudioPlayer } from "@/components/layout/site-audio";
import { FlappyRewardOptions } from "./flappy-reward-options";
import { initialFlappy, stepFlappy, MAX_TICKS, MAX_INPUTS, MIN_FLAP_TICKS, type FlappyState } from "@/lib/game/flappy/engine";
import { FLAPPY_COMPETITION_ENABLED } from "@/lib/game/flappy/activation";
import { FlappyOfficialError, readFlappyAvailability, startFlappyOfficial, checkpointFlappyOfficial, finalizeFlappyOfficial, type FlappySession, type FlappyResult } from "@/lib/game/flappy/official-client";

import type { FlappyAvailability } from "@/lib/game/flappy/availability";

type Status = "ready" | "starting" | "running" | "validating" | "over" | "rejected";
export function FlappyVerifiedCanvas({ language, authenticated }: { language: "en" | "es"; authenticated: boolean }) {
  const es = language === "es";
  const canvas = useRef<HTMLCanvasElement>(null);
  const birdImage = useRef<HTMLImageElement | null>(null);
  const forestImage = useRef<HTMLImageElement | null>(null);
  useEffect(() => { const img = new Image(); img.src="/images/flappy-forest-background.jpg"; img.onload=()=>{forestImage.current=img;}; return ()=>{img.onload=null; forestImage.current=null;}; }, []);
  useEffect(() => {
    const img = new Image();
    img.src="/images/Flappy-bird%20.png";
    img.onload=()=>{
      // Remove the dark checkerboard baked into the source artwork.
      const surface=document.createElement("canvas");
      surface.width=img.naturalWidth;surface.height=img.naturalHeight;
      const context=surface.getContext("2d",{willReadFrequently:true});
      if(!context){birdImage.current=img;return;}
      context.drawImage(img,0,0);
      const frame=context.getImageData(0,0,surface.width,surface.height);
      const pixels=frame.data, w=surface.width,h=surface.height;
      const seen=new Uint8Array(w*h), queue:number[]=[];
      const candidate=(idx:number)=>{
        const o=idx*4,r=pixels[o],g=pixels[o+1],b=pixels[o+2];
        return pixels[o+3]>0 && Math.max(r,g,b)-Math.min(r,g,b)<35 && Math.max(r,g,b)<175;
      };
      const push=(idx:number)=>{if(!seen[idx]&&candidate(idx)){seen[idx]=1;queue.push(idx);}};
      for(let x=0;x<w;x++){push(x);push((h-1)*w+x);}
      for(let y=0;y<h;y++){push(y*w);push(y*w+w-1);}
      for(let i=0;i<queue.length;i++){
        const idx=queue[i],x=idx%w,y=Math.floor(idx/w);
        pixels[idx*4+3]=0;
        if(x>0)push(idx-1);if(x<w-1)push(idx+1);
        if(y>0)push(idx-w);if(y<h-1)push(idx+w);
      }
      context.putImageData(frame,0,0);
      const cleaned=new Image();
      cleaned.src=surface.toDataURL("image/png");
      cleaned.onload=()=>{birdImage.current=cleaned;};
    };
    return ()=>{img.onload=null;birdImage.current=null;};
  }, []);
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
  const [officialError, setOfficialError] = useState<string | null>(null);
  const [availability, setAvailability] = useState<FlappyAvailability | null>(null);
  const [availabilityError, setAvailabilityError] = useState<string | null>(null);
  const [seconds, setSeconds] = useState<number | null>(null);
  const snapshot = useRef<{ data: FlappyAvailability; received: number } | null>(null);
  const reading = useRef(false);
  const refreshAvailability = useCallback(async () => {
    if (!authenticated || reading.current) return;
    reading.current = true;
    try {
      const data = await readFlappyAvailability();
      if (mounted.current) {
        snapshot.current = { data, received: performance.now() };
        setAvailability(data); setAvailabilityError(null);
      }
    } catch (error) { if (mounted.current) setAvailabilityError(error instanceof FlappyOfficialError ? error.code : "service_unavailable"); }
    finally { reading.current = false; }
  }, [authenticated]);
  useEffect(() => {
    const initial = window.setTimeout(() => void refreshAvailability(), 0);
    const tick = () => {
      const current = snapshot.current;
      if (current) {
        const until = current.data.nextAvailableAt;
        // Monotonic elapsed time animates server data only. It never grants an attempt.
        const now = Date.parse(current.data.serverNow) + performance.now() - current.received;
        setSeconds(until ? Math.max(0, Math.ceil((Date.parse(until) - now) / 1000)) : null);
        if ((until && now >= Date.parse(until)) || (current.data.activeUntil && now >= Date.parse(current.data.activeUntil))) void refreshAvailability();
      }
    };
    const timer = window.setInterval(tick, 1000);
    const poll = window.setInterval(() => { if (document.visibilityState === "visible") void refreshAvailability(); }, 15000);
    const focus = () => { void refreshAvailability(); };
    window.addEventListener("focus", focus); document.addEventListener("visibilitychange", focus);
    return () => { window.clearTimeout(initial); window.clearInterval(timer); window.clearInterval(poll); window.removeEventListener("focus", focus); document.removeEventListener("visibilitychange", focus); };
  }, [refreshAvailability]);
  const errorMessage = (code: string) => {
    const messages: Record<string, [string, string]> = {
      verified_email_required: ["Verifica tu correo antes de competir.", "Verify your email before competing."],
      identity_conflict: ["Esta identidad ya está asociada a otra cuenta. Contacta con administración.", "This identity is already associated with another account. Contact administration."],
      attempts_exhausted: ["No quedan partidas disponibles. Espera a recuperar un intento.", "No races remaining. Wait for your next attempt."],
      unauthenticated: ["Inicia sesión para jugar una partida oficial.", "Sign in to play an official race."],
      session_active: ["Ya tienes una partida oficial activa. Espera a que termine o caduque.", "You already have an active official race. Wait for it to finish or expire."],
      connection_error: ["No hay conexión. Comprueba tu conexión e inténtalo de nuevo.", "Connection failed. Check your connection and try again."],
      terms_required: ["Acepta los términos antes de competir.", "Accept the Terms before competing."],
      review_required: ["Acceso pendiente de revisión administrativa.", "Game access awaits administrative review."],
      rate_limited: ["Demasiadas solicitudes. Espera unos segundos y vuelve a intentarlo.", "Too many requests. Wait a few seconds and try again."],
      FLAPPY_OFFICIAL_DISABLED: ["La competición oficial no está disponible en este momento.", "Official competition is currently unavailable."],
    };
    return (messages[code] ?? ["Error del servidor. Vuelve a intentarlo en unos momentos.", "Server error. Please try again shortly."])[es ? 0 : 1];
  };
  const blocked = !authenticated || !FLAPPY_COMPETITION_ENABLED || !availability || !!availabilityError || availability.remaining === 0 || availability.activeUntil !== null;
  const recovery = seconds === null ? "…" : `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  const fail = useCallback(() => { running.current = false; if (mounted.current) { setResult(null); setStatus("rejected"); } }, []);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; running.current = false; }; }, [authenticated]);
  const flap = useCallback(() => { if (running.current && performance.now() >= origin.current) pendingFlap.current = true; }, []);
  const start = useCallback(async () => {
    if (busy.current || running.current || blocked) return;
    window.dispatchEvent(new Event("rtw-audio-start-flappy"));
    busy.current = true;
    setOfficialError(null); setRewardExpanded(false); setStatus("starting"); setResult(null); setScore(0);
    try {
      if (!authenticated) throw new FlappyOfficialError("unauthenticated");
      const session = await startFlappyOfficial();
      void refreshAvailability();
      if (!mounted.current) return;
      official.current = session;
      const seed = session.seed;
      engine.current = initialFlappy(seed); inputs.current = []; pendingFlap.current = false;
      nextCheckpoint.current = 300;
      origin.current = session ? performance.now() + (Date.parse(session.startsAt) - Date.parse(session.serverNow)) : performance.now() + 3000;
      if (origin.current <= performance.now()) throw new Error("Start schedule missed");
      setExpanded(true); setCountdown(Math.ceil((origin.current - performance.now()) / 1000));
      canvas.current?.focus({ preventScroll: true });
      running.current = true; lastFrame.current = performance.now(); setStatus("running");
    } catch (error) { setOfficialError(error instanceof FlappyOfficialError ? error.code : "service_unavailable"); fail(); }
    finally { busy.current = false; void refreshAvailability(); }
  }, [authenticated, blocked, fail, refreshAvailability]);

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
        // The uploaded forest artwork is the actual background; obstacles remain independent.
        const forest=forestImage.current;
        if(forest?.complete && forest.naturalWidth>0){
          ctx.drawImage(forest,0,0,forest.naturalWidth,forest.naturalHeight,0,0,360,480);
        }else{
          ctx.fillStyle="#275d4d";ctx.fillRect(0,0,360,480);
        }
        for(const p of g.pipes){
          const x=p.x/100, top=(p.gap-7500)/100, bottom=(p.gap+7500)/100;
          const trunk=(y: number,h: number,capY: number)=>{
            ctx.fillStyle="#6b4128";ctx.fillRect(x,y,54,h);
            ctx.fillStyle="#9b6740";ctx.fillRect(x+8,y,7,h);
            ctx.fillStyle="#422c22";ctx.fillRect(x+36,y,5,h);
            ctx.fillStyle="#347d36";ctx.fillRect(x-4,capY,62,12);
            ctx.fillStyle="#6fb74d";ctx.fillRect(x-2,capY,58,5);
            ctx.strokeStyle="#2e843b";ctx.lineWidth=3;
            ctx.beginPath();ctx.moveTo(x+40,y);ctx.bezierCurveTo(x+16,y+h*.25,x+64,y+h*.6,x+24,y+h);ctx.stroke();
          };
          trunk(0,Math.max(0,top),Math.max(0,top-10));
          trunk(bottom,Math.max(0,480-bottom),bottom);
        }
        if(birdImage.current?.complete && birdImage.current.naturalWidth){ctx.drawImage(birdImage.current,62,g.y/100-20,40,40);}else{ctx.fillStyle="#eab308";ctx.beginPath();ctx.arc(82,g.y/100,13,0,Math.PI*2);ctx.fill();}
        

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
    },5000);
    return () => window.clearTimeout(timer);
  },[status,authenticated,rewardExpanded]);
  useEffect(() => {
    if (status !== "over" && status !== "rejected") return;
    const timer = window.setTimeout(() => void refreshAvailability(), 0);
    return () => window.clearTimeout(timer);
  }, [status, refreshAvailability]);
  const terminal = status === "over" || status === "rejected";
  return <div style={{textAlign:"center"}}>
    <div style={expanded ? {position:"fixed",inset:0,zIndex:9999,background:"#071a2c",width:"100vw",height:"100dvh",display:"flex",alignItems:"center",justifyContent:"center",overflow:"hidden"} : {position:"relative",width:"100%",maxWidth:640,margin:"auto"}}>
      <AudioPlayer channel="flappy" playing={status==="starting"||status==="running"} />
      <canvas ref={canvas} width={360} height={480} tabIndex={0} aria-label="Flappy mini game" onPointerDown={() => { canvas.current?.focus({ preventScroll: true }); flap(); }} style={expanded ? {display:"block",width:"100%",height:"100%",objectFit:"contain",touchAction:"none"} : {display:"block",width:"100%",height:"auto",aspectRatio:"3 / 4",objectFit:"fill",border:"1px solid #23617c",borderRadius:12,touchAction:"manipulation"}} />
      {!expanded ? <button className="button button--primary" type="button" onClick={() => {void start();}} disabled={blocked || status==="starting"} style={{position:"absolute",top:"50%",left:"50%",transform:"translate(-50%,-50%)",borderRadius:999,border:"2px solid #67e8f9",background:"#0865d8",color:"white",padding:"1rem 2rem",fontSize:"1.3rem",fontWeight:900,cursor:"pointer",boxShadow:"0 0 30px #0369a1"}}>{status==="starting" ? "…" : "▶ PLAY"}</button> : null}
      {expanded && countdown!==null ? <div aria-live="assertive" style={{position:"absolute",fontSize:"5rem",fontWeight:900,pointerEvents:"none"}}>{countdown}</div> : null}
      {expanded && status==="running" && countdown===null ? <div style={{position:"absolute",top:"max(1rem, env(safe-area-inset-top))",left:16,padding:".5rem 1rem",background:"#071a2ccc",borderRadius:12,pointerEvents:"none",fontWeight:800}}>SCORE: {score}</div> : null}
      {expanded && (terminal || status==="validating") ? <div role="status" style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",gap:16,background:"#06121de8",padding:20,overflowY:"auto",justifyContent:"safe center"}}>
        <h2>GAME OVER</h2>
        {result ? <p>{es ? "Pendiente de revisión antifraude. Aún no cuenta para el ranking." : "Pending antifraud review. Not included in ranking yet."}</p> : null}
        {terminal ? <FlappyRewardOptions es={es} onOpenChange={setRewardExpanded} /> : null}
        {terminal ? <button className="button button--primary" type="button" disabled={blocked} onClick={() => {void start();}}>PLAY AGAIN</button> : null}
      </div> : null}
    </div>
    <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:".75rem",flexWrap:"wrap",margin:"1rem auto .5rem"}}>
      <Link href="/" className="button button--secondary">← BACK TO HOME</Link>
      {!expanded ? <div className="rtw-game-local-share"><ShareGameButton game="flappy-race" /></div> : null}
    </div>
    <p>{es ? "Toca o pulsa ESPACIO para volar. Evita los obstáculos." : "Tap or press SPACE to fly. Dodge the obstacles."}</p>
    {FLAPPY_COMPETITION_ENABLED && !authenticated ? <p><Link className="button" href="/sign-in?next=%2Fgames%2Fflappy-race">{es ? "COMPETIR · INICIAR SESIÓN" : "COMPETE · SIGN IN"}</Link></p> : null}
    <div style={{margin:"1rem auto",maxWidth:360}}>
      <p style={{margin:".5rem 0"}}>{es ? "Partidas disponibles" : "Races available"}: <span className="rtw-play-count" style={{position:"static"}} aria-live="polite"><span className="rtw-play-count__ticket" aria-hidden="true">◉</span>{availabilityError ? "—" : availability?.remaining ?? "…"}/5</span></p>
      {availability?.nextAvailableAt ? <p style={{margin:".5rem 0"}}>{es ? "Próxima partida disponible en" : "Next race available in"}: <strong>{recovery}</strong></p> : null}
      {availability?.remaining === 0 ? <p role="status">{errorMessage("attempts_exhausted")}</p> : null}
      {availability?.activeUntil && !["running","starting","validating"].includes(status) ? <p role="status">{errorMessage("session_active")}</p> : null}
      {availabilityError ? <p role="alert">{errorMessage(availabilityError)} {availabilityError === "terms_required" ? <Link href="/terms/accept">TERMS</Link> : availabilityError === "review_required" ? <Link href="/support/access">SUPPORT</Link> : availabilityError === "unauthenticated" ? <Link href="/sign-in?next=%2Fgames%2Fflappy-race">SIGN IN</Link> : null} <button type="button" className="button" onClick={() => void refreshAvailability()}>{es ? "REINTENTAR" : "RETRY"}</button></p> : null}
    </div>
    {officialError ? <p role="alert">{errorMessage(officialError)} {officialError==="terms_required" ? <Link href="/terms/accept">TERMS</Link> : officialError==="review_required" ? <Link href="/support/access">SUPPORT</Link> : officialError==="unauthenticated" ? <Link href="/sign-in?next=%2Fgames%2Fflappy-race">SIGN IN</Link> : null}</p> : null}
  </div>;
}
