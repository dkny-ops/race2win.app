import { mutateFlappyAdmin } from "@/lib/game/flappy/admin-mutations";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function POST(request:Request){return mutateFlappyAdmin("close-week",request);}
