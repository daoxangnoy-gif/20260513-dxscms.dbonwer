import { supabase } from "@/integrations/supabase/client";

export type PackBox = { pack: number | null; box: number | null };

// Incremental cache — เก็บ SKU ที่เคยดึงไว้แล้ว ไม่ดึงซ้ำ
let cache: { ts: number; map: Map<string, PackBox> } | null = null;
const TTL_MS = 30 * 60 * 1000; // 30 min

function parsePackBox(row: any): PackBox {
  const pack = row?.pack_qty == null || row?.pack_qty === "" ? null : Number(row.pack_qty);
  const box = row?.box_qty == null || row?.box_qty === "" ? null : Number(row.box_qty);
  return {
    pack: Number.isFinite(pack as number) ? (pack as number) : null,
    box: Number.isFinite(box as number) ? (box as number) : null,
  };
}

/**
 * Load Pack/Box per sku_code — targeted fetch (only requested SKUs).
 * Results cached in-memory for 30 minutes; already-cached SKUs are never re-fetched.
 *
 * @param skuCodes - list of SKUs needed. If omitted, falls back to full-table fetch.
 */
export async function getLatestRangeStorePackBox(
  skuCodes?: string[],
  forceRefresh = false
): Promise<Map<string, PackBox>> {
  const now = Date.now();

  // Reset cache if expired or forced
  if (forceRefresh || !cache || now - cache.ts > TTL_MS) {
    cache = { ts: now, map: new Map() };
  }

  // No SKU list → full fetch (backward compat, e.g. RangeStorePage)
  if (!skuCodes || skuCodes.length === 0) {
    if (cache.map.size > 0) return cache.map;
    return fetchAll();
  }

  // Find which SKUs are missing from cache
  const missing = skuCodes.filter(s => s && !cache!.map.has(s));
  if (missing.length > 0) {
    await fetchBySkus(missing);
  }

  return cache.map;
}

async function fetchBySkus(skus: string[]): Promise<void> {
  const CHUNK = 500;
  try {
    for (let i = 0; i < skus.length; i += CHUNK) {
      const chunk = skus.slice(i, i + CHUNK);
      const { data, error } = await supabase
        .from("range_store_view")
        .select("sku_code, pack_qty, box_qty")
        .in("sku_code", chunk);
      if (error) { console.warn("[rangeStorePackBox] fetch error:", error); break; }
      for (const row of (data as any[]) || []) {
        if (row?.sku_code) cache!.map.set(String(row.sku_code), parsePackBox(row));
      }
    }
  } catch (e) {
    console.warn("[rangeStorePackBox] unexpected error:", e);
  }
}

async function fetchAll(): Promise<Map<string, PackBox>> {
  const PAGE = 1000;
  let from = 0;
  try {
    while (true) {
      const { data, error } = await supabase
        .from("range_store_view")
        .select("sku_code, pack_qty, box_qty")
        .range(from, from + PAGE - 1);
      if (error) { console.warn("[rangeStorePackBox] fetch error:", error); break; }
      const rows = (data as any[]) || [];
      for (const row of rows) {
        if (row?.sku_code) cache!.map.set(String(row.sku_code), parsePackBox(row));
      }
      if (rows.length < PAGE) break;
      from += PAGE;
    }
  } catch (e) {
    console.warn("[rangeStorePackBox] unexpected error:", e);
  }
  return cache!.map;
}

export function clearRangeStorePackBoxCache() {
  cache = null;
}
