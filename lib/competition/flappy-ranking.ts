import "server-only";
import { currentNewYorkTournamentWeek } from "@/lib/competition/scores";
import { createAdminClient } from "@/lib/supabase/admin";
import { FLAPPY_COMPETITION_ENABLED } from "@/lib/game/flappy/activation";
export const FLAPPY_GAME_SLUG="flappy-race";
export const FLAPPY_OFFICIAL_ENABLED=FLAPPY_COMPETITION_ENABLED;
export type FlappyRanking={
 game:"flappy-race";tournamentWeek:string;page:number;hasNextPage:boolean;officialEnabled:boolean;
 entries:{rank:number|null;username:string;weeklyTotal:number;reviewRequired:boolean}[];
};
export function parseFlappyPage(params: URLSearchParams): number | null {
  if ([...params.keys()].some(key => key !== "page") || params.getAll("page").length > 1) return null;
  const raw = params.get("page") ?? "1";
  if (!/^[1-9]\d{0,2}$/.test(raw)) return null;
  const page = Number(raw);
  return page <= 100 ? page : null;
}

export async function readFlappyRanking(page:number):Promise<FlappyRanking>{
 if(!Number.isSafeInteger(page)||page<1||page>100)throw new Error("Invalid page");
 const week=currentNewYorkTournamentWeek();
 const {data,error}=await createAdminClient().rpc("flappy_read_ranking",{p_week:week,p_page:page});
 if(error||!data||!Array.isArray(data.entries)||data.entries.length>50||typeof data.hasNextPage!=="boolean"||typeof data.officialEnabled!=="boolean")throw new Error("Ranking unavailable");
 const names=new Set<string>();
 const entries=data.entries.map((row:FlappyRanking["entries"][number])=>{
  if(!row||typeof row.username!=="string"||!row.username.trim()||names.has(row.username)||
   !Number.isSafeInteger(row.weeklyTotal)||row.weeklyTotal<0||row.weeklyTotal>24500||
   typeof row.reviewRequired!=="boolean"||(row.reviewRequired?row.rank!==null:(!Number.isSafeInteger(row.rank)||Number(row.rank)<1)))throw new Error("Invalid ranking metadata");
  names.add(row.username);
  return {rank:row.rank,username:row.username,weeklyTotal:row.weeklyTotal,reviewRequired:row.reviewRequired};
 });
 return {game:FLAPPY_GAME_SLUG,tournamentWeek:week,page,hasNextPage:data.hasNextPage,officialEnabled:FLAPPY_OFFICIAL_ENABLED && data.officialEnabled,entries};
}
