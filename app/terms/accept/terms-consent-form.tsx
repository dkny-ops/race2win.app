"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export function TermsConsentForm() {
 const router = useRouter();
 const [accepted,setAccepted] = useState(false);
 const [busy,setBusy] = useState(false);
 const [error,setError] = useState("");
 async function confirm() {
  if (!accepted || busy) return;
  setBusy(true); setError("");
  try {
   const response = await fetch("/api/terms/accept", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({accepted:true}), credentials:"same-origin" });
   if (!response.ok) throw new Error("Acceptance could not be saved.");
   router.replace("/"); router.refresh();
  } catch { setError("Could not save your acceptance. Please try again."); setBusy(false); }
 }
 return <div className="sign-in-panel" style={{maxWidth:"min(100%,760px)"}}>
  <p className="eyebrow">RACE TO WIN · PLAYER AGREEMENT</p>
  <h1>TERMS & CONDITIONS</h1>
  <p className="page-lede">Read the terms before participating in official tournaments. Acceptance is optional; without it, you cannot start official tournament runs.</p>
  <iframe title="Complete Race To Win Terms of Use" src="/legal/terms" style={{width:"100%",height:"min(48vh,520px)",border:"1px solid rgba(255,255,255,.25)",borderRadius:"12px",background:"#101014"}} />
  <p>Read the entire agreement above or <Link href="/legal/terms" target="_blank" rel="noopener noreferrer">open the full Terms of Use in a new tab</Link>.</p>
  <label className="acknowledgement" style={{display:"flex",gap:".75rem",alignItems:"center",marginTop:"1rem"}}><input type="checkbox" checked={accepted} onChange={e=>setAccepted(e.target.checked)}/><span>I have read and agree to the complete Terms of Use and tournament verification rules.</span></label>
  <button className="button button--primary" type="button" disabled={!accepted||busy} onClick={()=>void confirm()}>{busy?"SAVING...":"ACCEPT & CONTINUE TO HOME"}</button>
  <Link className="button button--secondary" href="/">NOT NOW · HOME (NO TOURNAMENT)</Link>
  {error?<p role="alert" className="sign-in-notice">{error}</p>:null}
 </div>;
}
