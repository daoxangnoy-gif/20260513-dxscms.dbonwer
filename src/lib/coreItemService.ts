import { supabase } from "@/integrations/supabase/client";

// Map<id18(sku_code), ranking|null> — มี key = Core Item, ไม่มี = Normal Item
// เงื่อนไขเดียวกับ Report OOS (ReportOOSPage)
let cache: { ts: number; map: Map<string, string | null> } | null = null;
const TTL_MS = 5 * 60 * 1000;

export async function fetchCoreItemMap(): Promise<Map<string, string | null>> {
  if (cache && Date.now() - cache.ts < TTL_MS) return cache.map;
  const { data, error } = await (supabase as any)
    .from("core_item")
    .select("id18,ranking")
    .limit(10000);
  if (error) throw error;
  const map = new Map<string, string | null>(
    (data || []).map((c: any) => [String(c.id18), c.ranking ?? null])
  );
  cache = { ts: Date.now(), map };
  return map;
}

export function coreItemLabel(map: Map<string, string | null>, sku: string): string {
  return map.has(sku) ? "Core Item" : "Normal Item";
}

export function coreItemRanking(map: Map<string, string | null>, sku: string): string {
  return map.get(sku) ?? "";
}
