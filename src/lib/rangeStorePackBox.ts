import { supabase } from "@/integrations/supabase/client";

export type PackBox = { pack: number | null; box: number | null };

let cache: { ts: number; map: Map<string, PackBox> } | null = null;
const TTL_MS = 5 * 60 * 1000; // 5 min

/**
 * Load Pack/Box (qty) per sku_code from range_store_view (live).
 * Cached in-memory for 5 minutes.
 */
export async function getLatestRangeStorePackBox(forceRefresh = false): Promise<Map<string, PackBox>> {
  if (!forceRefresh && cache && Date.now() - cache.ts < TTL_MS) {
    return cache.map;
  }

  const map = new Map<string, PackBox>();
  try {
    // Page through range_store_view (PostgREST 1000-row cap)
    const PAGE = 1000;
    let from = 0;
    while (true) {
      const { data, error } = await supabase
        .from("range_store_view")
        .select("sku_code, pack_qty, box_qty")
        .range(from, from + PAGE - 1);
      if (error) {
        console.warn("[rangeStorePackBox] fetch error:", error);
        break;
      }
      const rows = (data as any[]) || [];
      for (const row of rows) {
        const sku = row?.sku_code;
        if (!sku) continue;
        const pack = row?.pack_qty == null || row?.pack_qty === "" ? null : Number(row.pack_qty);
        const box = row?.box_qty == null || row?.box_qty === "" ? null : Number(row.box_qty);
        map.set(String(sku), {
          pack: Number.isFinite(pack as number) ? (pack as number) : null,
          box: Number.isFinite(box as number) ? (box as number) : null,
        });
      }
      if (rows.length < PAGE) break;
      from += PAGE;
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
