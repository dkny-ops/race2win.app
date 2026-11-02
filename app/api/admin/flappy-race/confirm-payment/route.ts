import { NextResponse } from "next/server";
import { getAuthorizedPrizeAdmin } from "@/lib/security/prize-admin";
import { readBoundedJson } from "@/lib/competition/request-body";
import { parseFlappyWeek } from "@/lib/game/flappy/tournament";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store" };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const reply = (status:number,message:string)=>NextResponse.json({message},{status,headers});

export async function POST(request:Request){
 try{
  if(request.headers.get("origin")!==new URL(request.url).origin||request.headers.get("sec-fetch-site")==="cross-site")return reply(403,"Solicitud no autorizada.");
  const auth=await getAuthorizedPrizeAdmin();
  if(!auth)return reply(404,"No disponible.");
  const body=await readBoundedJson(request);
  if(!body||typeof body!=="object"||Array.isArray(body))return reply(400,"Solicitud inválida.");
  const b=body as Record<string,unknown>;
  const week=parseFlappyWeek(b.week);
  if(Object.keys(b).length!==5||!week||typeof b.playerId!=="string"||!uuid.test(b.playerId)||typeof b.winnerId!=="string"||!uuid.test(b.winnerId)||b.confirmedPaidByOwner!==true||typeof b.note!=="string"||!b.note.trim()||b.note.length>500)return reply(400,"Confirmación inválida.");
  const {data:game,error:gameError}=await auth.admin.from("games").select("id").eq("slug","flappy-race").maybeSingle();
  if(gameError||!game)return reply(503,"Juego no disponible.");
  const {data:award,error:awardError}=await auth.admin.from("provisional_winners").select("id,status,allocation_status,amount_cents").eq("id",b.winnerId).eq("player_id",b.playerId).eq("game_id",game.id).eq("tournament_week_start",week).eq("award_type","weekly_tournament").maybeSingle();
  if(awardError||!award||award.status!=="approved_for_payment"||award.allocation_status!=="allocated")return reply(409,"El premio no está acreditado o no pertenece a este ganador.");
  const {data:balance,error:balanceError}=await auth.admin.from("prize_balances").select("available_cents").eq("player_id",b.playerId).maybeSingle();
  if(balanceError||!balance||balance.available_cents<2000)return reply(409,"El balance no alcanza el mínimo de $20.");
  const {data:paid,error}=await auth.admin.rpc("rtw_owner_confirm_full_balance_paid",{p_actor:auth.context.userId,p_player:b.playerId,p_winner:b.winnerId});
  if(error||typeof paid!=="number")return reply(409,"No se pudo registrar el pago. Verifica el balance y los retiros pendientes.");
  return NextResponse.json({paidCents:paid,message:"Pago externo registrado. Balance disponible: $0.00."},{headers});
 }catch{return reply(503,"No se pudo confirmar el pago.");}
}
