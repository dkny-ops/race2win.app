import { NextResponse } from "next/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { getVerifiedUserContext } from "@/lib/supabase/server";
import { OFFICIAL_SESSION_UUID, parseOfficialInputs, readOfficialSessionJson } from "@/lib/game/race-to-win/official-inputs";
import { MAX_OFFICIAL_INPUTS, replayAuthoritativeProgress } from "@/lib/game/race-to-win";
import { digestOfficialInputs } from "@/lib/game/race-to-win/checkpoints";
export const runtime = "nodejs";
export async function POST(request: Request) {
 const headers = { "Cache-Control": "no-store" };
 try {
  if (request.headers.get("origin") !== new URL(request.url).origin) return NextResponse.json({ message:"Forbidden" },{status:403,headers});
  const body = await readOfficialSessionJson(request);
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({message:"Invalid"},{status:400,headers});
  const data = body as Record<string,unknown>;
  if (Object.keys(data).length !== 2 || typeof data.sessionId !== "string" || !OFFICIAL_SESSION_UUID.test(data.sessionId)) return NextResponse.json({message:"Invalid"},{status:400,headers});
  const inputs = parseOfficialInputs(data.inputs,MAX_OFFICIAL_INPUTS);
  if (!inputs) return NextResponse.json({message:"Invalid"},{status:400,headers});
  const user = await getVerifiedUserContext();
  if (!user || !isAdminConfigured()) return NextResponse.json({message:"Unavailable"},{status:401,headers});
  const admin = createAdminClient();
  const {data:session,error} = await admin.from("game_sessions").select("id,user_id,seed,gameplay_version,started_at,status").eq("id",data.sessionId).eq("user_id",user.userId).maybeSingle();
  if (error || !session || session.status!=="active") return NextResponse.json({message:"Unavailable"},{status:409,headers});
  const {data:checks,error:checkError}=await admin.rpc("rtw_read_human_check",{p_session_id:session.id,p_player_id:user.userId});
  const check=Array.isArray(checks)?checks[0]:null;
  if (checkError || !check || check.status!=="pending" || Date.now()<Date.parse(check.due_at)+10000) return NextResponse.json({message:"Not timed out"},{status:409,headers});
  const cap=Math.max(0,Math.floor(Date.parse(check.due_at)-Date.parse(session.started_at)));
  const replay=replayAuthoritativeProgress(session.gameplay_version,Number(session.seed),inputs,cap);
  if (!replay || replay.state!=="running") return NextResponse.json({message:"Invalid replay"},{status:409,headers});
  const {data:result,error:rpcError}=await admin.rpc("rtw_end_human_check_timeout",{
   p_session_id:session.id,p_player_id:user.userId,p_input_digest:digestOfficialInputs(inputs),p_input_count:inputs.length,
   p_score:replay.score,p_distance:replay.distanceMillimeters,p_elapsed:replay.elapsedMs
  });
  if (rpcError || !result?.[0]) return NextResponse.json({message:"Timeout could not be recorded"},{status:409,headers});
  return NextResponse.json({score:result[0].score,distanceMillimeters:result[0].distance_millimeters,elapsedMs:result[0].elapsed_ms,reason:"human_check_timeout",ranked:false},{headers});
 } catch {return NextResponse.json({message:"Unavailable"},{status:503,headers});}
}
