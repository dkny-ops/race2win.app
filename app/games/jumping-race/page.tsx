import Link from "next/link";
import { JumpingRaceGame } from "@/components/game/jumping-race-game";

export const dynamic = "force-dynamic";
export const metadata = { title: "Jumping Race", robots: { index: false, follow: false } };

export default function JumpingRacePage() {
  return <main className="page-section shell" style={{ paddingTop: "7rem", minHeight: "70vh", textAlign: "center" }}>
    <JumpingRaceGame />
    <div style={{ marginTop: 20 }}><Link className="button button--secondary" href="/">← VOLVER A HOME</Link></div>
  </main>;
}
