import Link from "next/link";
import Image from "next/image";
import { FlappyGuide } from "@/components/marketing/game-guides";

export const metadata = { title: "How To Play | Flappy Race" };
export default function GameInstructionsPage() {
 return <main className="page-section shell narrow rtw-instructions-page">
  <Link href="/games/flappy-race" className="rtw-instructions-back" aria-label="Back to game start screen" title="Back to game"><Image src="/images/back-home-blue.svg" alt="" width={54} height={54} unoptimized /><span>BACK</span></Link>
  <FlappyGuide />
 </main>;
}
