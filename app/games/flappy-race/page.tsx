import type { Metadata } from "next";
import Link from "next/link";
import { FlappyRacePage } from "@/components/game/flappy-race-page";

export const metadata: Metadata = { title: "Flappy Race | Race To Win", description: "Play the free Flappy Race mini game." };

export default function Page() {
 return <main className="page-section shell narrow" style={{ textAlign: "center" }}>
  <nav style={{ textAlign: "left", marginBottom: "1rem" }}><Link href="/" className="button button--secondary">← BACK TO HOME</Link></nav>
  <h1>FLAPPY RACE</h1>
  <FlappyRacePage />
 </main>;
}
