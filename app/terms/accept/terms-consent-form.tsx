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
  <div tabIndex={0} aria-label="Terms and conditions" style={{maxHeight:"48vh",overflowY:"auto",border:"1px solid rgba(255,255,255,.25)",borderRadius:"12px",padding:"1rem",textAlign:"left"}}>
   <p><strong>Terms of Use and Prize Verification Policy · October 18, 2026</strong></p>
   <p>Only verified runs count. Weekly scores use the seven best eligible runs each day, Monday through Sunday in New York time. Rankings and displayed prizes remain provisional until validated.</p>
   <p>Cheating, bots, score tampering, unauthorized access, collusion and fraudulent claims are prohibited. Suspicious activity may be held for review. Confirmed serious or repeated misconduct may result in disqualification or permanent suspension. Opening developer tools alone is not proof of cheating.</p>
   <p>All prize eligibility, identity and payment information is subject to verification. A human reviewer makes final decisions; no prize is paid without explicit human authorization. A US$10 minimum withdrawal applies only where adopted in official competition rules. Rules for claim windows, age, jurisdictions and payout methods must be published before cash-prize entry.</p>
   <p>Suspensions and disqualifications are subject to reasonable review and appeal. Records are handled according to the Privacy Policy. Prize competitions are not guaranteed to be active.</p>
   <p><strong>The complete binding text is available at <Link href="/legal/terms" target="_blank" rel="noopener noreferrer">Terms of Use (open full document)</Link>.</strong> By accepting you agree to the complete Terms of Use, not only this summary.</p>
  </div>
  <label className="acknowledgement" style={{display:"flex",gap:".75rem",alignItems:"center",marginTop:"1rem"}}><input type="checkbox" checked={accepted} onChange={e=>setAccepted(e.target.checked)}/><span>I have read and agree to the complete Terms of Use and tournament verification rules.</span></label>
  <button className="button button--primary" type="button" disabled={!accepted||busy} onClick={()=>void confirm()}>{busy?"SAVING...":"ACCEPT & CONTINUE TO HOME"}</button>
  <Link className="button button--secondary" href="/">NOT NOW · HOME (NO TOURNAMENT)</Link>
  {error?<p role="alert" className="sign-in-notice">{error}</p>:null}
 </div>;
}
