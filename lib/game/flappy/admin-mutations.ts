import "server-only";
import { NextResponse } from "next/server";
import { readBoundedJson } from "@/lib/competition/request-body";
import { getAuthorizedPrizeAdmin } from "@/lib/security/prize-admin";
import { summarizeFlappyAudit } from "./admin-review";
import { parseFlappyWeek } from "./tournament";
const headers={"Cache-Control":"private, no-store"};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function response(status:number,message:string){return NextResponse.json({message},{status,headers});}
export async function mutateFlappyAdmin(action:"review"|"close-week",request:Request) {
 try {
  if(request.headers.get("origin")!==new URL(request.url).origin||request.headers.get("sec-fetch-site")==="cross-site")return response(403,"Request unavailable.");
  const authorization=await getAuthorizedPrizeAdmin();
  if(!authorization)return response(404,"Unavailable.");
  const body=await readBoundedJson(request);
  if(!body||typeof body!=="object"||Array.isArray(body))return response(400,"Invalid request.");
  const b=body as Record<string,unknown>,actor=authorization.context.userId;
  if(action==="close-week"){
   const week=parseFlappyWeek(b.week);
   if(Object.keys(b).length!==2||!week||b.confirmed!==true)return response(400,"Invalid closure request.");
   const {error}=await authorization.admin.rpc("flappy_close_week",{p_actor:actor,p_week:week});
   return error?response(409,"Week unavailable: check pending reviews and settlement time."):response(200,"Week closed. No prizes or payments generated.");
  }
  if(Object.keys(b).length!==4||typeof b.sessionId!=="string"||!uuid.test(b.sessionId)||
   (b.decision!=="valid"&&b.decision!=="disqualified")||typeof b.note!=="string"||
   !b.note.trim()||b.note.length>500||b.humanReviewed!==true)return response(400,"Invalid review request.");
  const {data,error}=await authorization.admin.rpc("flappy_admin_read",{p_actor:actor,p_page:1,p_session:b.sessionId});
  if(error||!Array.isArray(data)||data.length!==1)return response(409,"Evidence unavailable.");
  const audit=summarizeFlappyAudit(data[0]);
  if(audit.status!=="finalized"||(b.decision==="valid"&&audit.replayMatches!==true))return response(409,"Replay evidence does not permit approval.");
  const reviewed=await authorization.admin.rpc("flappy_review_run",{p_actor:actor,p_session:b.sessionId,p_decision:b.decision,p_note:b.note.trim()});
  return reviewed.error?response(409,"Review conflict or week closed."):response(200,"Review recorded. No prizes or payments generated.");
 }catch{return response(503,"Review temporarily unavailable.");}
}
