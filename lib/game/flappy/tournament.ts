import "server-only";
import { currentNewYorkTournamentWeek } from "@/lib/competition/scores";
import { createAdminClient } from "@/lib/supabase/admin";
export function parseFlappyWeek(value: unknown): string | null {
 if(typeof value!=="string"||!/^20\d{2}-\d{2}-\d{2}$/.test(value)) return null;
 const day=new Date(value+"T12:00:00Z");
 return Number.isFinite(day.getTime())&&day.getUTCDay()===1&&day.toISOString().slice(0,10)===value?value:null;
}
export function previousFlappyWeek() {
 const date=new Date(currentNewYorkTournamentWeek()+"T12:00:00Z");date.setUTCDate(date.getUTCDate()-7);return date.toISOString().slice(0,10);
}
export async function readFlappyWeek(week: string) {
 const {data,error}=await createAdminClient().rpc("flappy_read_week",{p_week:week});
 if(error||!data||data.week!==week||!Array.isArray(data.winners))throw new Error("Tournament unavailable");
 return data;
}
