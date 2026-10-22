"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { TurnstileScript } from "@/app/sign-in/turnstile-widget";
type Check = { due: boolean; verified: boolean; nonce: string | null; target: number | null; siteKey: string | null };
const SYMBOLS = ["●", "▲", "■", "★"];
export function MidrunHumanCheck({ sessionId, running, onPauseChange }: { sessionId: string | null; running: boolean; onPauseChange: (paused: boolean) => void }) {
 const [check, setCheck] = useState<Check | null>(null);
 const [ready, setReady] = useState(false);
 const [busy, setBusy] = useState(false);
 const [message, setMessage] = useState("");
 const container = useRef<HTMLDivElement>(null);
 const widget = useRef<string | null>(null);
 const chosen = useRef<number | null>(null);
 const latest = useRef<Check | null>(null);
 const refreshInFlight = useRef(false);
 const currentSession = useRef(sessionId);
 currentSession.current = sessionId;
 const refresh = useCallback(async () => {
  if (!sessionId || refreshInFlight.current) return;
  refreshInFlight.current = true;
  try {
   const response = await fetch("/api/game-sessions/human-check?sessionId=" + encodeURIComponent(sessionId), { credentials: "same-origin", cache: "no-store" });
   if (!response.ok) return;
   const body = await response.json() as Check;
   if (currentSession.current !== sessionId) return;
   if (typeof body.due !== "boolean" || typeof body.verified !== "boolean") return;
   latest.current = body; setCheck(body);
  } catch { /* server holds unverified results */ }
  finally { refreshInFlight.current = false; }
 }, [sessionId]);
 useEffect(() => {
  setCheck(null); latest.current = null; chosen.current = null; setMessage(""); setBusy(false);
  if (!running || !sessionId) return;
  void refresh();
  const timer = window.setInterval(() => { void refresh(); }, 500);
  return () => window.clearInterval(timer);
 }, [sessionId, running, refresh]);
 useEffect(() => { onPauseChange(Boolean(running && sessionId && check?.due && !check.verified)); return () => onPauseChange(false); }, [running, sessionId, check?.due, check?.verified, onPauseChange]);
 const onToken = useCallback(async (token: string) => {
  const active = latest.current;
  const choice = chosen.current;
  const id = currentSession.current;
  if (!active || !id || !active.nonce || choice === null) return;
  try {
   const response = await fetch("/api/game-sessions/human-check", {
    method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId: id, nonce: active.nonce, choice, turnstileToken: token }),
   });
   if (!response.ok) throw new Error("verification_failed");
   if (currentSession.current !== id) return;
   setMessage("Verification complete"); setCheck({ ...active, verified: true }); latest.current = { ...active, verified: true };
  } catch {
   if (currentSession.current === id) { setMessage("Verification pending. Try again."); window.turnstile?.reset(widget.current ?? ""); }
  } finally { if (currentSession.current === id) setBusy(false); }
 }, []);
 useEffect(() => {
  if (!running || !ready || !check?.due || check.verified || !check.siteKey || !container.current || widget.current || !window.turnstile) return;
  const id = window.turnstile.render(container.current, {
   sitekey: check.siteKey, action: "midrun_human_check",
   size: "invisible", execution: "execute", appearance: "interaction-only",
   callback: onToken, "expired-callback": () => { setBusy(false); setMessage("Try verification again."); },
   "error-callback": () => { setBusy(false); setMessage("Verification pending. Try again."); },
  });
  widget.current = id;
  return () => { if (widget.current === id) widget.current = null; window.turnstile?.remove(id); };
 }, [running, ready, check?.due, check?.verified, check?.siteKey, onToken]);
 if (!running || !sessionId || !check?.due || check.verified) return null;
 return <aside onPointerDown={(event) => event.stopPropagation()} onPointerUp={(event) => event.stopPropagation()} role="group" aria-label="Human verification" style={{ position:"absolute",top:85,left:"50%",transform:"translateX(-50%)",zIndex:30,background:"rgba(0,0,0,.88)",color:"white",padding:12,borderRadius:12,textAlign:"center",maxWidth:"90vw",pointerEvents:"auto" }}>
  <TurnstileScript onReady={() => setReady(true)} onError={() => setMessage("Verification service unavailable")} />
  <p style={{margin:"0 0 8px"}}>Tap the matching symbol to verify your run</p>
  <p style={{fontSize:22,margin:"0 0 8px"}} aria-label="Target symbol">{SYMBOLS[check.target ?? 0]}</p>
  <div style={{display:"flex",gap:12,justifyContent:"center"}}>
   {SYMBOLS.map((symbol,index)=><button key={index} type="button" disabled={busy || !check.siteKey || !ready} onClick={() => {
    if (index !== check.target) { setMessage("Try the matching symbol."); return; }
    chosen.current=index; setBusy(true); setMessage("Checking...");
    if (widget.current) window.turnstile?.execute(widget.current);
    else { setBusy(false); setMessage("Verification unavailable."); }
   }} style={{fontSize:22,padding:"8px 12px",borderRadius:8}} aria-label={"Select symbol "+symbol}>{symbol}</button>)}
  </div>
  <div ref={container} />
  {message && <p role="status" style={{fontSize:12,margin:"8px 0 0"}}>{message}</p>}
 </aside>;
}