import { NextResponse } from "next/server";
import { parseFlappyWeek,readFlappyWeek,previousFlappyWeek } from "@/lib/game/flappy/tournament";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const headers={"Cache-Control":"private, no-store"};
export async function GET(request:Request){
 const params=new URL(request.url).searchParams;
 const week=parseFlappyWeek(params.get("week")??previousFlappyWeek());
 if(!week||[...params.keys()].some(k=>k!=="week")||params.getAll("week").length>1)return NextResponse.json({message:"Invalid tournament request."},{status:400,headers});
 try{return NextResponse.json(await readFlappyWeek(week),{headers});}
 catch{return NextResponse.json({message:"Tournament temporarily unavailable."},{status:503,headers});}
}
