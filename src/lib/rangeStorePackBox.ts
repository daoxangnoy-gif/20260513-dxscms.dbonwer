import { supabase } from "@/integrations/supabase/client";

export type PackBox = { pack: number | null; box: number | null };

let cache: { ts: number; map: Map<string, PackBox> } | null = null;
const TTL_MS = 5 * 60 * 1000; // 5 min

/**
 * Load Pack/Box (qty) per sku_code from the LATEST range_store_snapshots row
 * (most recent by created_at). Returns empty map if no snapshot exists.
 * Cached in-memory for 5 minutes.
 */
export async function getLatestRangeStorePackBox(forceRefresh = false): Promise<Map<string, PackBox>> {
  if (!forceRefresh && cache && Date.now() - cache.ts < TTL_MS) {
    return cache.map;
  }

  const map = new Map<string, PackBox>();
  try {
    const { data, error } = await supabase
      .from("range_store_snapshots")
      .select("data, created_at")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.warn("[rangeStorePackBox] fetch error:", error);
      cache = { ts: Date.now(), map };
      return map;
    }

    const arr = (data?.data as any[]) || [];
    for (const row of arr) {
      const sku = row?.sku_code;
      if (!sku) continue;
      const pack = row?.pack_qty == null || row?.pack_qty === "" ? null : Number(row.pack_qty);
      const box = row?.box_qty == null || row?.box_qty === "" ? null : Number(row.box_qty);
      map.set(String(sku), {
        pack: Number.isFinite(pack as number) ? (pack as number) : null,
        box: Number.isFinite(box as number) ? (box as number) : null,
      });
    }
  } catch (e) {
    console.warn("[rangeStorePackBox] unexpected error:", e);
  }

  cache = { ts: Date.now(), map };
  return map;
}

export function clearRangeStorePackBoxCache() {
  cache = null;
}
