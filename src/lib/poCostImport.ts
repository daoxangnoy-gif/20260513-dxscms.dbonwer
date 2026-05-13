import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";

export interface PoCostImportRow {
  rowIdx: number;
  rawKey: string;       // ID/SKU/Barcode user provided
  rawVendor: string;    // vendor code user provided
  poCost: number | null;
  moq: number | null;
}

export interface PoCostSkipRow {
  key: string;
  productName: string;
  poCost: number | null;
  moq: number | null;
  vendor: string;
  reason: string;
  suggestUnit: number | null; // packing_size_qty suggestion
}

export interface PoCostResolved {
  item_id: string;
  goodcode: string | null;
  product_name: string | null;
  moq: number;
  po_cost: number;
  po_cost_unit: number;
  vendor: string;
}

export interface PoCostMarginWarning {
  resolved: PoCostResolved;
  skip: PoCostSkipRow;
  marginPct2km: number | null;
  marginPctJmart: number | null;
  list_price: number | null;
  jmart_price: number | null;
  currency?: string | null;
  fxRate?: number | null;
  poCostLak?: number | null;
  poCostUnitLak?: number | null;
}

export interface PoCostFxOptions {
  rateTHB?: number | null;
  rateUSD?: number | null;
}

export interface PoCostImportResult {
  toUpsert: PoCostResolved[];
  skipped: PoCostSkipRow[];
  marginWarnings: PoCostMarginWarning[];
}

const NORMALIZE = (s: any) => String(s ?? "").trim();
const TO_NUM = (v: any): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};

// Map header → field
function mapHeaders(headers: string[]) {
  const find = (keywords: string[]) =>
    headers.find(h => {
      const norm = h.toLowerCase().replace(/[\s_\-/().]+/g, "");
      return keywords.some(k => norm === k || norm.includes(k));
    });
  return {
    keyCol: find(["idskucodebarcode", "idskucode", "skucode", "barcode", "id", "sku"]),
    poCostCol: find(["pocost", "cost"]),
    moqCol: find(["moq", "1x"]),
    vendorCol: find(["vendorcode", "vendor"]),
  };
}

export async function parsePoCostFile(file: File): Promise<PoCostImportRow[]> {
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const json = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: "" });
  if (json.length === 0) return [];

  const headers = Object.keys(json[0]);
  const cols = mapHeaders(headers);
  if (!cols.keyCol) throw new Error("ไม่พบคอลัมน์ ID/SKUcode/Barcode ในไฟล์");
  if (!cols.poCostCol) throw new Error("ไม่พบคอลัมน์ Po cost ในไฟล์");
  if (!cols.moqCol) throw new Error("ไม่พบคอลัมน์ Moq ในไฟล์");
  if (!cols.vendorCol) throw new Error("ไม่พบคอลัมน์ Vendor code ในไฟล์");

  return json.map((r, i) => ({
    rowIdx: i + 1,
    rawKey: NORMALIZE(r[cols.keyCol!]),
    rawVendor: NORMALIZE(r[cols.vendorCol!]),
    poCost: TO_NUM(r[cols.poCostCol!]),
    moq: TO_NUM(r[cols.moqCol!]),
  })).filter(r => r.rawKey);
}

export async function resolvePoCostImport(
  rows: PoCostImportRow[],
  onProgress?: (cur: number, total: number, phase: string) => void,
  fxOptions?: PoCostFxOptions,
): Promise<PoCostImportResult> {
  if (rows.length === 0) return { toUpsert: [], skipped: [], marginWarnings: [] };

  // 1) Collect all unique keys + variants (handle Excel leading-zero loss)
  const keysOriginal = Array.from(new Set(rows.map(r => r.rawKey)));
  // For each key, also generate zero-padded variants (Excel often strips leading zeros from numeric SKUs)
  const expandKey = (k: string): string[] => {
    const variants = new Set<string>([k]);
    if (/^\d+$/.test(k)) {
      // Pad to common SKU lengths (10, 11, 12, 13 digits) — covers most barcodes/SKU codes
      for (const len of [10, 11, 12, 13]) {
        if (k.length < len) variants.add(k.padStart(len, "0"));
      }
    }
    return Array.from(variants);
  };
  const allKeyVariants = Array.from(new Set(keysOriginal.flatMap(expandKey)));
  onProgress?.(0, keysOriginal.length, "กำลังค้นหาสินค้าใน Master...");

  // 2) Lookup data_master via 3 parallel .in() queries (much faster than OR filters)
  // IMPORTANT: A single SKU can have MULTIPLE rows in data_master (different packing sizes / barcodes).
  // Store ALL candidates per key so we can later pick the row whose packing_size_qty matches the import MOQ.
  type MasterRow = { sku_code: string; main_barcode: string | null; product_name: string | null; packing_size_qty: number | null; vendor_code: string | null; list_price: number | null; jmart_price: number | null };
  const masterMap = new Map<string, MasterRow[]>();
  const pushCandidate = (key: string, row: MasterRow) => {
    const k = NORMALIZE(key);
    if (!k) return;
    const arr = masterMap.get(k);
    if (arr) {
      // Avoid exact duplicates
      if (!arr.some(x => x.packing_size_qty === row.packing_size_qty && x.main_barcode === row.main_barcode)) {
        arr.push(row);
      }
    } else {
      masterMap.set(k, [row]);
    }
  };

  // IMPORTANT: Supabase has a default 1000-row cap per request. A single SKU can have
  // multiple data_master rows (different packing sizes / barcodes), so 1000 keys could
  // easily produce >1000 rows and silently truncate the result. We:
  //   (a) Use a smaller key chunk (300) so worst-case rows stay well under 1000, AND
  //   (b) Page through with .range() inside each chunk to recover all rows even if cap is hit.
  const fetchByCol = async (col: "sku_code" | "main_barcode" | "barcode") => {
    const results: any[] = [];
    const chunkSize = 300;
    const pageSize = 1000;
    for (let i = 0; i < allKeyVariants.length; i += chunkSize) {
      const chunk = allKeyVariants.slice(i, i + chunkSize);
      let from = 0;
      // Page until a partial page is returned (means we've drained this chunk).
      // Cap at 20 pages (=20k rows per chunk) as a safety guard.
      for (let page = 0; page < 20; page++) {
        const { data, error } = await supabase
          .from("data_master")
          .select("sku_code, main_barcode, barcode, product_name_la, product_name_en, packing_size_qty, vendor_code, list_price, jmart_price")
          .in(col, chunk)
          .range(from, from + pageSize - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        results.push(...data);
        if (data.length < pageSize) break;
        from += pageSize;
      }
    }
    return results;
  };

  const [bySku, byMain, byBar] = await Promise.all([
    fetchByCol("sku_code"),
    fetchByCol("main_barcode"),
    fetchByCol("barcode"),
  ]);

  // Index by sku_code so we can later expand candidates to ALL packings of the same SKU.
  // FIX: When user imports a barcode (e.g. piece-level barcode), data_master row for that
  // barcode has its own packing_size_qty (e.g. 1). But the SKU may have other rows with
  // different packing sizes (e.g. box=12). We must compare MOQ against ANY of those packings.
  const bySkuMap = new Map<string, MasterRow[]>();
  for (const row of [...bySku, ...byMain, ...byBar]) {
    const mRow: MasterRow = {
      sku_code: row.sku_code || "",
      main_barcode: row.main_barcode || null,
      product_name: row.product_name_la || row.product_name_en || null,
      packing_size_qty: row.packing_size_qty,
      vendor_code: row.vendor_code,
      list_price: row.list_price ?? null,
      jmart_price: row.jmart_price ?? null,
    };
    [row.sku_code, row.main_barcode, row.barcode].forEach((k: any) => {
      if (k) pushCandidate(String(k), mRow);
    });
    if (mRow.sku_code) {
      const arr = bySkuMap.get(mRow.sku_code) || [];
      if (!arr.some(x => x.packing_size_qty === mRow.packing_size_qty && x.main_barcode === mRow.main_barcode)) {
        arr.push(mRow);
      }
      bySkuMap.set(mRow.sku_code, arr);
    }
  }

  // Second pass: for each found SKU, fetch ALL data_master rows with the same sku_code
  // (covers cases where the imported barcode's row was the only one returned, but the SKU
  // has additional packing rows we haven't loaded yet).
  const allSkuCodes = Array.from(bySkuMap.keys()).filter(Boolean);
  if (allSkuCodes.length > 0) {
    const extraRows: any[] = [];
    const chunkSize = 500;
    const pageSize = 1000;
    for (let i = 0; i < allSkuCodes.length; i += chunkSize) {
      const chunk = allSkuCodes.slice(i, i + chunkSize);
      let from = 0;
      for (let page = 0; page < 20; page++) {
        const { data, error } = await supabase
          .from("data_master")
          .select("sku_code, main_barcode, barcode, product_name_la, product_name_en, packing_size_qty, vendor_code, list_price, jmart_price")
          .in("sku_code", chunk)
          .range(from, from + pageSize - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        extraRows.push(...data);
        if (data.length < pageSize) break;
        from += pageSize;
      }
    }
    for (const row of extraRows) {
      const mRow: MasterRow = {
        sku_code: row.sku_code || "",
        main_barcode: row.main_barcode || null,
        product_name: row.product_name_la || row.product_name_en || null,
        packing_size_qty: row.packing_size_qty,
        vendor_code: row.vendor_code,
        list_price: row.list_price ?? null,
        jmart_price: row.jmart_price ?? null,
      };
      if (!mRow.sku_code) continue;
      const arr = bySkuMap.get(mRow.sku_code) || [];
      if (!arr.some(x => x.packing_size_qty === mRow.packing_size_qty && x.main_barcode === mRow.main_barcode)) {
        arr.push(mRow);
        bySkuMap.set(mRow.sku_code, arr);
      }
    }
  }
  onProgress?.(keysOriginal.length, keysOriginal.length, "กำลังค้นหาสินค้าใน Master...");

  // 2.5) Fetch vendor currencies (for FX conversion of PO Cost → LAK before margin%).
  // Vendor codes can come from the import file (rawVendor) or from data_master fallback.
  const vendorCodesAll = new Set<string>();
  for (const r of rows) {
    const v = (r.rawVendor || "").split("-")[0].trim();
    if (v) vendorCodesAll.add(v);
  }
  for (const arr of masterMap.values()) {
    for (const c of arr) {
      if (c.vendor_code) vendorCodesAll.add(String(c.vendor_code).split("-")[0].trim());
    }
  }
  const vendorCurrencyMap = new Map<string, string>();
  if (vendorCodesAll.size > 0) {
    const list = Array.from(vendorCodesAll);
    const chunkSize = 500;
    for (let i = 0; i < list.length; i += chunkSize) {
      const chunk = list.slice(i, i + chunkSize);
      const { data } = await supabase
        .from("vendor_master")
        .select("vendor_code, supplier_currency")
        .in("vendor_code", chunk);
      if (data) {
        for (const v of data) {
          if (v.vendor_code && v.supplier_currency) {
            vendorCurrencyMap.set(String(v.vendor_code), String(v.supplier_currency).toUpperCase());
          }
        }
      }
    }
  }
  const rThb = fxOptions?.rateTHB ?? null;
  const rUsd = fxOptions?.rateUSD ?? null;
  const toLak = (cost: number, currency: string): number | null => {
    if (!Number.isFinite(cost)) return null;
    const cur = (currency || "").toUpperCase();
    if (cur === "LAK" || cur === "") return cost;
    if (cur === "THB") return (Number.isFinite(rThb!) && (rThb as number) > 0) ? cost * (rThb as number) : null;
    if (cur === "USD") return (Number.isFinite(rUsd!) && (rUsd as number) > 0) ? cost * (rUsd as number) : null;
    return cost;
  };

  // 3) Process each row
  const toUpsert: PoCostResolved[] = [];
  const skipped: PoCostSkipRow[] = [];
  const marginWarnings: PoCostMarginWarning[] = [];

  // Helper: lookup ALL master candidates for a key (try original + zero-padded variants)
  const lookupCandidates = (rawKey: string): MasterRow[] => {
    const direct = masterMap.get(rawKey);
    if (direct && direct.length) return direct;
    if (/^\d+$/.test(rawKey)) {
      for (const len of [10, 11, 12, 13]) {
        if (rawKey.length < len) {
          const padded = rawKey.padStart(len, "0");
          const m = masterMap.get(padded);
          if (m && m.length) return m;
        }
      }
    }
    return [];
  };

  // Pick the best matching master row given import MOQ:
  // 1) Prefer row where packing_size_qty === MOQ
  // 2) Else prefer row with non-null packing_size_qty
  // 3) Else fall back to first candidate
  const pickBestMatch = (candidates: MasterRow[], moq: number | null): MasterRow | undefined => {
    if (candidates.length === 0) return undefined;
    if (moq !== null) {
      const exact = candidates.find(c => Number(c.packing_size_qty) === Number(moq));
      if (exact) return exact;
    }
    const withPacking = candidates.find(c => c.packing_size_qty !== null && c.packing_size_qty !== 0);
    return withPacking || candidates[0];
  };

  for (const r of rows) {
    const directCandidates = lookupCandidates(r.rawKey);
    // FIX: Expand candidates to ALL data_master rows sharing the same sku_code as the
    // imported barcode. This way, importing a piece-barcode but providing a box-MOQ
    // will still match the box-packing row.
    const skuCodes = Array.from(new Set(directCandidates.map(c => c.sku_code).filter(Boolean)));
    let candidates: MasterRow[] = [];
    if (skuCodes.length > 0) {
      const seen = new Set<string>();
      for (const sku of skuCodes) {
        const sameSku = bySkuMap.get(sku) || [];
        for (const c of sameSku) {
          const key = `${c.sku_code}|${c.packing_size_qty}|${c.main_barcode}`;
          if (!seen.has(key)) { seen.add(key); candidates.push(c); }
        }
      }
    } else {
      candidates = directCandidates;
    }
    const m = pickBestMatch(candidates, r.moq);
    const productName = m?.product_name || "";
    // Normalize vendor: keep only code (strip "-Name" suffix if any)
    const rawVend = (r.rawVendor || m?.vendor_code || "").split("-")[0].trim();
    const vendor = rawVend;

    if (!m) {
      skipped.push({
        key: r.rawKey, productName: "", poCost: r.poCost, moq: r.moq, vendor,
        reason: "ไม่พบสินค้าใน Data Master",
        suggestUnit: null,
      });
      continue;
    }

    if (r.poCost === null || r.poCost <= 0) {
      skipped.push({
        key: r.rawKey, productName, poCost: r.poCost, moq: r.moq, vendor,
        reason: "ไม่มีค่า PO Cost",
        suggestUnit: m.packing_size_qty,
      });
      continue;
    }

    if (r.moq === null) {
      skipped.push({
        key: r.rawKey, productName, poCost: r.poCost, moq: r.moq, vendor,
        reason: "ไม่มีค่า MOQ",
        suggestUnit: m.packing_size_qty,
      });
      continue;
    }

    // Check whether MOQ matches ANY packing size for this SKU (not only the imported barcode's row).
    const allSizesNum = candidates
      .map(c => c.packing_size_qty)
      .filter(v => v !== null && v !== undefined) as number[];
    const hasAnyPacking = allSizesNum.length > 0;
    const matchesAnyPacking = hasAnyPacking && allSizesNum.some(p => Number(p) === Number(r.moq));

    if (!hasAnyPacking) {
      skipped.push({
        key: r.rawKey, productName, poCost: r.poCost, moq: r.moq, vendor,
        reason: "Data Master ไม่มี Packing Size Qty",
        suggestUnit: null,
      });
      continue;
    }

    if (!matchesAnyPacking) {
      const allSizes = Array.from(new Set(allSizesNum)).join(", ");
      skipped.push({
        key: r.rawKey, productName, poCost: r.poCost, moq: r.moq, vendor,
        reason: `MOQ ไม่ตรงกับ Packing Size Qty (มีในระบบ: ${allSizes}) ใน Data Master`,
        suggestUnit: m.packing_size_qty,
      });
      continue;
    }

    if (!vendor) {
      skipped.push({
        key: r.rawKey, productName, poCost: r.poCost, moq: r.moq, vendor: "",
        reason: "ไม่ระบุ Vendor Code",
        suggestUnit: m.packing_size_qty,
      });
      continue;
    }

    // Margin check (per side, 2KM and Jmart computed independently):
    // PO Cost in vendor's currency must be converted to LAK before comparing with prices (LAK).
    // For each side: prefer the MOQ-matching row's price (compare vs full po_cost).
    // If that row's price for this side is null/0, fall back to unit row price (compare vs po_cost_unit).
    const poCostUnit = r.poCost / r.moq;
    const vendorCurrency = vendorCurrencyMap.get(vendor) || "";
    const poCostLak = toLak(r.poCost, vendorCurrency);
    const poCostUnitLak = toLak(poCostUnit, vendorCurrency);
    const moqRow = candidates.find(c => Number(c.packing_size_qty) === Number(r.moq));
    const unitRow = candidates.find(c => Number(c.packing_size_qty) === 1) || m;
    const validPrice = (p: any) => p !== null && p !== undefined && Number.isFinite(Number(p)) && Number(p) > 0;

    const pickFor = (field: "list_price" | "jmart_price") => {
      if (moqRow && validPrice((moqRow as any)[field]) && poCostLak !== null) {
        return { price: Number((moqRow as any)[field]) as number, cost: poCostLak };
      }
      if (unitRow && validPrice((unitRow as any)[field]) && poCostUnitLak !== null) {
        return { price: Number((unitRow as any)[field]) as number, cost: poCostUnitLak };
      }
      return null;
    };
    const calc = (sel: { price: number; cost: number } | null): number | null =>
      sel ? ((sel.price - sel.cost) / sel.price) * 100 : null;

    const sel2km = pickFor("list_price");
    const selJm = pickFor("jmart_price");
    const m2km = calc(sel2km);
    const mJm = calc(selJm);
    const priceList = sel2km ? sel2km.price : null;
    const priceJmart = selJm ? selJm.price : null;
    const flagged = (v: number | null) => v !== null && (v > 50 || v < 0.5);
    const reasons: string[] = [];
    if (flagged(m2km)) reasons.push(`2KM ${(m2km as number).toFixed(2)}%`);
    if (flagged(mJm)) reasons.push(`Jmart ${(mJm as number).toFixed(2)}%`);

    const resolved: PoCostResolved = {
      item_id: m.sku_code,
      goodcode: m.main_barcode,
      product_name: productName,
      moq: r.moq,
      po_cost: r.poCost,
      po_cost_unit: poCostUnit,
      vendor,
    };
    toUpsert.push(resolved);

    if (reasons.length > 0) {
      const fxRate = vendorCurrency === "THB" ? rThb : vendorCurrency === "USD" ? rUsd : (vendorCurrency === "LAK" || vendorCurrency === "" ? 1 : null);
      marginWarnings.push({
        resolved,
        skip: {
          key: r.rawKey, productName, poCost: r.poCost, moq: r.moq, vendor,
          reason: `Margin% ผิดปกติ (เกณฑ์: >50% หรือ <0.5%): ${reasons.join(", ")}`,
          suggestUnit: m.packing_size_qty,
        },
        marginPct2km: m2km,
        marginPctJmart: mJm,
        list_price: priceList,
        jmart_price: priceJmart,
        currency: vendorCurrency || null,
        fxRate: fxRate ?? null,
        poCostLak,
        poCostUnitLak,
      });
    }
  }

  return { toUpsert, skipped, marginWarnings };
}

// Split resolved rows into existing (will be updated) and missing (not found by item_id+vendor)
export async function splitExistingMissing(
  resolved: PoCostResolved[],
): Promise<{ existing: PoCostResolved[]; missing: PoCostResolved[] }> {
  if (resolved.length === 0) return { existing: [], missing: [] };
  const itemIds = Array.from(new Set(resolved.map(r => r.item_id)));
  const vendors = Array.from(new Set(resolved.map(r => r.vendor)));
  const { data, error } = await supabase
    .from("po_cost")
    .select("item_id, vendor")
    .in("item_id", itemIds)
    .in("vendor", vendors);
  if (error) throw error;
  const existSet = new Set((data || []).map(e => `${e.item_id}||${e.vendor}`));
  const existing: PoCostResolved[] = [];
  const missing: PoCostResolved[] = [];
  for (const r of resolved) {
    if (existSet.has(`${r.item_id}||${r.vendor}`)) existing.push(r);
    else missing.push(r);
  }
  return { existing, missing };
}

// Convert resolved rows to skip rows (used when user chooses to Skip missing keys in Update mode)
export function resolvedToSkipRows(rows: PoCostResolved[], reason: string): PoCostSkipRow[] {
  return rows.map(r => ({
    key: r.item_id,
    productName: r.product_name || "",
    poCost: r.po_cost,
    moq: r.moq,
    vendor: r.vendor,
    reason,
    suggestUnit: r.moq,
  }));
}

export async function applyPoCostImport(
  resolved: PoCostResolved[],
  mode: "insert" | "update",
  onProgress?: (cur: number, total: number, phase: string) => void,
): Promise<{ inserted: number; updated: number }> {
  let inserted = 0;
  let updated = 0;
  const total = resolved.length;
  const batchSize = 1000;
  const concurrency = 8;

  // De-duplicate within the file itself by (item_id, vendor) — Postgres ON CONFLICT
  // cannot handle the same key appearing twice in a single statement.
  const dedupMap = new Map<string, PoCostResolved>();
  for (const r of resolved) dedupMap.set(`${r.item_id}||${r.vendor}`, r);
  const deduped = Array.from(dedupMap.values());

  // Build batches
  const batches: PoCostResolved[][] = [];
  for (let i = 0; i < deduped.length; i += batchSize) {
    batches.push(deduped.slice(i, i + batchSize));
  }

  let done = 0;
  const runBatch = async (batch: PoCostResolved[]) => {
    if (mode === "insert") {
      // Plain insert — fastest. Caller already filtered to NEW rows only via splitExistingMissing.
      const { error } = await supabase.from("po_cost").insert(batch);
      if (error) {
        // If a duplicate slipped through (rare), fall back to upsert with ignore.
        const { error: upErr } = await supabase
          .from("po_cost")
          .upsert(batch, { onConflict: "item_id,vendor", ignoreDuplicates: true });
        if (upErr) throw upErr;
      }
    } else {
      // Update mode → upsert (REPLACES existing rows on item_id+vendor; uses unique index for speed).
      const { error } = await supabase
        .from("po_cost")
        .upsert(batch, { onConflict: "item_id,vendor" });
      if (error) throw error;
    }
    done += batch.length;
    onProgress?.(Math.min(done, total), total, mode === "update" ? "กำลังอัปเดต (แทนที่ค่าเดิม)..." : "กำลังนำเข้า...");
  };

  for (let i = 0; i < batches.length; i += concurrency) {
    const group = batches.slice(i, i + concurrency);
    await Promise.all(group.map(runBatch));
  }

  if (mode === "insert") {
    inserted = deduped.length;
  } else {
    // For update mode, count via single existence query (cheap thanks to new unique index).
    const itemIds = Array.from(new Set(deduped.map(r => r.item_id)));
    const vendors = Array.from(new Set(deduped.map(r => r.vendor)));
    const { data: existing } = await supabase
      .from("po_cost")
      .select("item_id, vendor")
      .in("item_id", itemIds)
      .in("vendor", vendors);
    const existingSet = new Set((existing || []).map(e => `${e.item_id}||${e.vendor}`));
    for (const r of deduped) {
      if (existingSet.has(`${r.item_id}||${r.vendor}`)) updated++;
      else inserted++;
    }
  }

  return { inserted, updated };
}

export function downloadSkipList(skipped: PoCostSkipRow[]) {
  const rows = skipped.map(s => ({
    "ID/SKUcode/Barcode": s.key,
    "Product Name": s.productName,
    "Po Cost": s.poCost ?? "",
    "Moq": s.moq ?? "",
    "Vendor": s.vendor,
    "Reason": s.reason,
    "Suggest Unit (Packing Size Qty)": s.suggestUnit ?? "",
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Skip List");
  XLSX.writeFile(wb, `po_cost_skip_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

export function downloadPoCostTemplate() {
  const rows = [{
    "ID/SKUcode/Barcode": "",
    "Po Cost": "",
    "Moq": "",
    "Vendor Code": "",
  }];
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Template");
  XLSX.writeFile(wb, "po_cost_template.xlsx");
}

// Lookup Vendor display info: { vendor_code: "Currency - Code - Name" }
export async function loadVendorDisplayMap(vendorCodes: string[]): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const unique = Array.from(new Set(vendorCodes.filter(Boolean)));
  if (unique.length === 0) return result;
  const { data, error } = await supabase
    .from("vendor_master")
    .select("vendor_code, vendor_name_en, vendor_name_la, supplier_currency")
    .in("vendor_code", unique);
  if (error) return result;
  for (const v of data || []) {
    const name = v.vendor_name_en || v.vendor_name_la || "";
    const cur = v.supplier_currency || "";
    const display = [cur, v.vendor_code, name].filter(Boolean).join(" - ");
    if (v.vendor_code) result.set(v.vendor_code, display);
  }
  return result;
}
