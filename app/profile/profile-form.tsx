"use client";

import { FormEvent, useEffect, useState } from "react";

type Profile = { username: string | null; paypalEmail: string | null };

export function ProfileForm() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [username, setUsername] = useState("");
  const [paypalEmail, setPaypalEmail] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [notice, setNotice] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/profile", { cache: "no-store" });
        if (!response.ok) throw new Error();
        const data = await response.json() as Profile;
        setProfile(data);
        setUsername(data.username ?? "");
        setPaypalEmail(data.paypalEmail ?? "");
      } catch {
        setNotice("Your profile is unavailable right now. Please try again.");
      }
    })();
  }, []);

  async function save(changes: Record<string, unknown>) {
    setIsSaving(true);
    setNotice("");
    try {
      const response = await fetch("/api/profile", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(changes) });
      const data: unknown = await response.json();
      if (!response.ok) {
        setNotice(typeof data === "object" && data !== null && "message" in data ? String((data as { message: unknown }).message) : "Your profile could not be saved. Please try again.");
        return;
      }
      const updated = data as Profile;
      setProfile(updated);
      setUsername(updated.username ?? "");
      setPaypalEmail(updated.paypalEmail ?? "");
      setNotice("Saved.");
    } catch {
      setNotice("Your profile could not be saved. Please try again.");
    } finally {
      setIsSaving(false);
    }
  }

  function handleUsernameSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void save({ username, acknowledgeUsername: acknowledged });
  }

  function handlePayPalSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void save({ paypalEmail });
  }

  if (!profile) return <p className="profile-status" aria-live="polite">{notice || "Loading profile…"}</p>;

  return <div className="profile-stack">
    <section className="profile-card" aria-labelledby="username-title">
      <p className="eyebrow">PLAYER ID</p><h2 id="username-title">USERNAME</h2>
      {profile.username ? <p className="readonly-username">{profile.username}</p> : <form className="profile-form" onSubmit={handleUsernameSubmit} noValidate><p className="profile-warning">Choose carefully. Your username cannot be changed after it is saved.</p><label htmlFor="username">USERNAME</label><input id="username" value={username} onChange={(event) => setUsername(event.target.value)} minLength={3} maxLength={20} autoComplete="nickname" placeholder="RACER_01" required /><label className="acknowledgement"><input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} required /> <span>I understand this username cannot be changed.</span></label><button className="button button--primary" type="submit" disabled={isSaving}>{isSaving ? "SAVING..." : "SAVE USERNAME"}</button></form>}
    </section>
    <section className="profile-card" aria-labelledby="paypal-title">
      <p className="eyebrow">PAYOUT DETAILS</p><h2 id="paypal-title">PAYPAL EMAIL</h2><p className="profile-warning">This information is used only for potential prize payouts. Never enter your PayPal password or security codes.</p><form className="profile-form" onSubmit={handlePayPalSubmit} noValidate><label htmlFor="paypal-email">PAYPAL EMAIL</label><input id="paypal-email" type="email" inputMode="email" autoComplete="email" value={paypalEmail} onChange={(event) => setPaypalEmail(event.target.value)} placeholder="you@example.com" /><button className="button button--secondary" type="submit" disabled={isSaving}>{isSaving ? "SAVING..." : "SAVE PAYPAL EMAIL"}</button></form>
    </section>
    <p className="profile-status" aria-live="polite">{notice}</p>
  </div>;
}
