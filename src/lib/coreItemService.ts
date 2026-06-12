import { supabase } from "@/integrations/supabase/client";

// Map<id18(sku_code), ranking|null> — มี key = Core Item, ไม่มี = Normal Item
// เงื่อนไขเดียวกับ Report OOS (ReportOOSPage)
let cache: { ts: number; map: Map<string, string | null> } | null = null;
const TTL_MS = 5 * 60 * 1000;

export async function fetchCoreItemMap(): Promise<Map<string, string | null>> {
  if (cache && Date.now() - cache.ts < TTL_MS) return cache.map;
  // Supabase ตัด response ที่ 1,000 แถวต่อ query → ต้องวนดึงทีละหน้า (core_item มี 3,000+ แถว)
  const map = new Map<string, string | null>();
  const pageSize = 1000;
  let offset = 0;
  while (true) {
    const { data, error } = await (supabase as any)
      .from("core_item")
      .select("id18,ranking")
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    for (const c of data || []) map.set(String(c.id18), c.ranking ?? null);
    if (!data || data.length < pageSize) break;
    offset += pageSize;
  }
  cache = { ts: Date.now(), map };
  return map;
}

export function coreItemLabel(map: Map<string, string | null>, sku: string): string {
  return map.has(sku) ? "Core Item" : "Normal Item";
}

export function coreItemRanking(map: Map<string, string | null>, sku: string): string {
  return map.get(sku) ?? "";
}
