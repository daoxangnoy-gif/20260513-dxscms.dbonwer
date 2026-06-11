import { supabase } from "@/integrations/supabase/client";

// ===== Types =====
export interface OOSRow {
  division: string;
  department: string;
  store_name: string;
  type_store: string;
  id_match: string;
  sku: string;
  barcode: string;
  name_la: string;
  vendor: string;
  teadterm: string;
  item_type: string;
  buying: string;
  rank_sale: string;
  store_apply: number;
  stock_store: number;
  stock_dc: number;
  remark_stock: string;
  remark_oos: string;
  ranking: string | null;   // Ranking จาก core_item (AA–BD) — ว่างถ้าไม่ใช่ core
  core_item: string;        // "Core Item" / "Normal Item"
}

export interface OOSFilters {
  spc?: string[];
  vendors?: string[];
  divisions?: string[];
  departments?: string[];
  typeStores?: string[];
  stores?: string[];
}

export interface OOSStoreSummary {
  type_store: string;
  store_name: string;
  have_stock: number; // distinct SKU (within a store, 1 row = 1 sku)
  oos: number;
  range: number;
  pct_oos: number; // 0..1
}

export interface OOSTypeTotal {
  type_store: string;
  have_stock: number; // distinct SKU
  oos: number;
  range: number;
}

export interface OOSSummary {
  stores: OOSStoreSummary[];
  totals: OOSTypeTotal[];
  grand: { have_stock: number; oos: number; range: number; pct_oos: number };
}

export interface OOSSnapshotMeta {
  id: string;
  week_label: string;
  snapshot_date: string;
  total_rows: number;
  created_at: string;
}

export interface OOSTrendRow {
  week_label: string;
  snapshot_date: string;
  type_store: string;
  n_range: number;
  n_oos: number;
}

export interface OOSFilterOptions {
  divisions: string[];
  departments: string[];
  spc: string[];
  type_stores: string[];
  stores: { store_name: string; type_store: string }[];
  vendors: { vendor_code: string; vendor_name_en: string; spc_name: string }[];
}

// ===== ISO week label =====
// คืนเลขสัปดาห์ ISO-8601 (สัปดาห์เริ่มวันจันทร์, สัปดาห์ที่มีวันพฤหัสฯ เป็นของปีนั้น)
export function getISOWeek(d: Date = new Date()): number {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = (date.getUTCDay() + 6) % 7; // จันทร์=0
  date.setUTCDate(date.getUTCDate() - dayNum + 3); // เลื่อนไปวันพฤหัสฯ ของสัปดาห์
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  return 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * 24 * 3600 * 1000));
}

export function getWeekLabel(d: Date = new Date()): string {
  return `Week ${getISOWeek(d)}`;
}

// แปลง OOSFilters -> arguments ของ RPC (array ว่าง => null = ไม่กรอง)
function toArgs(f: OOSFilters) {
  const arr = (v?: string[]) => (v && v.length ? v : null);
  return {
    p_spc: arr(f.spc),
    p_vendors: arr(f.vendors),
    p_divisions: arr(f.divisions),
    p_departments: arr(f.departments),
    p_type_stores: arr(f.typeStores),
    p_stores: arr(f.stores),
  };
}

// ===== RPC: Get detail (live) =====
export async function getOOSDetail(f: OOSFilters): Promise<OOSRow[]> {
  const { data, error } = await (supabase as any).rpc("get_oos_detail", toArgs(f));
  if (error) throw error;
  return (data || []) as OOSRow[];
}

// ตัวอย่างแถวแรกๆ แบบเร็ว (ไม่ sort) — โชว์ทันทีตอน Get
export async function getOOSDetailPreview(f: OOSFilters, limit = 100): Promise<OOSRow[]> {
  const { data, error } = await (supabase as any).rpc("get_oos_detail_preview", { ...toArgs(f), p_limit: limit });
  if (error) throw error;
  return (data || []) as OOSRow[];
}

// โหลดชุดเต็มทีละ chunk (ordered) — เลี่ยง payload ใหญ่ที่ทำให้ 520
export async function getOOSDetailPage(f: OOSFilters, limit: number, offset: number): Promise<OOSRow[]> {
  const { data, error } = await (supabase as any).rpc("get_oos_detail_page", {
    ...toArgs(f), p_limit: limit, p_offset: offset,
  });
  if (error) throw error;
  return (data || []) as OOSRow[];
}

// ===== RPC: Save snapshot (server-side INSERT...SELECT) =====
export async function saveOOSSnapshot(
  week: string,
  f: OOSFilters
): Promise<{ id: string; total_rows: number }> {
  const { data, error } = await (supabase as any).rpc("save_oos_snapshot", {
    p_week: week,
    p_filters: f as any,
    ...toArgs(f),
  });
  if (error) throw error;
  return data as { id: string; total_rows: number };
}

// ===== Materialized View: refresh + status =====
export async function refreshOOSMv(): Promise<{ refreshed_at: string; row_count: number }> {
  const { data, error } = await (supabase as any).rpc("refresh_oos_mv");
  if (error) throw error;
  return data as { refreshed_at: string; row_count: number };
}

export async function getOOSMvStatus(): Promise<{ refreshed_at: string | null; row_count: number | null }> {
  const { data, error } = await (supabase as any).rpc("get_oos_mv_status");
  if (error) throw error;
  return (data || { refreshed_at: null, row_count: null }) as { refreshed_at: string | null; row_count: number | null };
}

// ===== Filter options =====
export async function getOOSFilterOptions(): Promise<OOSFilterOptions> {
  const { data, error } = await (supabase as any).rpc("get_oos_filter_options");
  if (error) throw error;
  return data as OOSFilterOptions;
}

// ===== DC Coverage: ในสินค้า Store OOS — DC มีของให้เติมได้ไหม =====
export interface DCStoreRow {
  type_store: string; store_name: string;
  dc_have: number; dc_no: number; total_oos: number; pct_have: number;
}
export interface DCCoverage { stores: DCStoreRow[]; totals: DCStoreRow[]; }

export function computeDCCoverage(rows: OOSRow[]): DCCoverage {
  const storeMap = new Map<string, DCStoreRow>();
  // ราย type ต่อ sku: storeHas = มีของในสาขาใดสาขาหนึ่งไหม, dcHave = DC มีของไหม (uniform ต่อ sku)
  // Total ใช้ "ขาดทุกสาขา" (นิยาม B = !storeHas) ให้ตรงกับ Total ของ Report tab
  const typeSku = new Map<string, Map<string, { storeHas: boolean; dcHave: boolean }>>();
  for (const r of rows) {
    const ts = r.type_store || "(ไม่ระบุ)";
    const isOOS = r.remark_oos === "Store OOS";
    const dcHave = r.remark_stock === "DC Have stock";
    if (isOOS) {
      const sKey = `${ts}|||${r.store_name}`;
      let s = storeMap.get(sKey);
      if (!s) { s = { type_store: ts, store_name: r.store_name, dc_have: 0, dc_no: 0, total_oos: 0, pct_have: 0 }; storeMap.set(sKey, s); }
      s.total_oos++;
      if (dcHave) s.dc_have++; else s.dc_no++;
    }
    let m = typeSku.get(ts);
    if (!m) { m = new Map(); typeSku.set(ts, m); }
    const e = m.get(r.sku) || { storeHas: false, dcHave };
    if (!isOOS) e.storeHas = true;
    e.dcHave = dcHave;
    m.set(r.sku, e);
  }
  const stores = [...storeMap.values()]
    .map((s) => ({ ...s, pct_have: s.total_oos > 0 ? s.dc_have / s.total_oos : 0 }))
    .sort((a, b) => a.type_store.localeCompare(b.type_store) || a.store_name.localeCompare(b.store_name));
  const totals: DCStoreRow[] = [...typeSku.entries()].map(([ts, m]) => {
    let have = 0, no = 0;
    for (const e of m.values()) {
      if (e.storeHas) continue; // มีของบางสาขา → ไม่ใช่ "ขาดทุกสาขา"
      if (e.dcHave) have++; else no++;
    }
    const total = have + no;
    return { type_store: ts, store_name: "", dc_have: have, dc_no: no, total_oos: total, pct_have: total > 0 ? have / total : 0 };
  }).sort((a, b) => a.type_store.localeCompare(b.type_store));
  return { stores, totals };
}

// ===== เทียบ Report ราย store หลาย week =====
export interface OOSStoreSummaryRow {
  week_label: string; snapshot_date: string; type_store: string; store_name: string;
  have: number; oos: number; range_cnt: number;
}
export interface OOSTypeTotalRow {
  week_label: string; type_store: string; have: number; oos: number; range_cnt: number;
}
export interface DCSummaryRow {
  week_label: string; type_store: string; store_name?: string;
  dc_have: number; dc_no: number; total_oos: number;
}
export interface OOSCompareResult {
  stores: OOSStoreSummaryRow[]; totals: OOSTypeTotalRow[];
  dc_stores: DCSummaryRow[]; dc_totals: DCSummaryRow[];
}
export async function getOOSStoreSummary(weeks: string[]): Promise<OOSCompareResult> {
  const { data, error } = await (supabase as any).rpc("get_oos_store_summary", { p_weeks: weeks });
  if (error) throw error;
  return (data || { stores: [], totals: [], dc_stores: [], dc_totals: [] }) as OOSCompareResult;
}

// ===== Trend (เทียบ %OOS ระหว่าง week) =====
export async function getOOSTrend(): Promise<OOSTrendRow[]> {
  const { data, error } = await (supabase as any).rpc("get_oos_trend");
  if (error) throw error;
  return (data || []) as OOSTrendRow[];
}

// ===== Import snapshot จาก Excel (backfill week ย้อนหลัง) =====
// สร้าง header + batch insert rows แบบ parallel (รันใน browser ที่ login แล้ว → ผ่าน RLS)
export async function importOOSSnapshot(
  weekLabel: string,
  snapshotDate: string,
  rows: OOSRow[],
  onProgress?: (done: number, total: number) => void
): Promise<number> {
  // ทับ week เดิมถ้ามี (cascade ลบ rows)
  await (supabase as any).from("oos_snapshots").delete().eq("week_label", weekLabel);

  const { data: hdr, error: e1 } = await (supabase as any)
    .from("oos_snapshots")
    .insert({ week_label: weekLabel, snapshot_date: snapshotDate, total_rows: rows.length })
    .select("id")
    .single();
  if (e1) throw e1;
  const snapId = hdr.id as string;

  const payload = rows.map((r) => ({ snapshot_id: snapId, ...r }));
  const BATCH = 1000, CONCURRENCY = 6;
  const starts: number[] = [];
  for (let i = 0; i < payload.length; i += BATCH) starts.push(i);
  let cursor = 0, done = 0;
  const worker = async () => {
    while (true) {
      const idx = cursor++;
      if (idx >= starts.length) break;
      const slice = payload.slice(starts[idx], starts[idx] + BATCH);
      const { error } = await (supabase as any).from("oos_snapshot_rows").insert(slice);
      if (error) throw error;
      done += slice.length;
      onProgress?.(done, payload.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, starts.length) }, () => worker()));
  return payload.length;
}

// ===== Snapshots list / load =====
export async function listOOSSnapshots(): Promise<OOSSnapshotMeta[]> {
  const { data, error } = await (supabase as any)
    .from("oos_snapshots")
    .select("id, week_label, snapshot_date, total_rows, created_at")
    .order("snapshot_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []) as OOSSnapshotMeta[];
}

// ลบ snapshot (cascade ลบ rows อัตโนมัติจาก FK ON DELETE CASCADE)
export async function deleteOOSSnapshot(snapshotId: string): Promise<void> {
  const { error } = await (supabase as any).from("oos_snapshots").delete().eq("id", snapshotId);
  if (error) throw error;
}

// โหลดแถวของ snapshot — ยิงหลายหน้าพร้อมกัน (parallel) เพราะ Supabase จำกัด 1000 แถว/request
// เร็วกว่าโหลดทีละหน้าเรียงกัน ~6-8 เท่า (ใช้ทั้งเปิด snapshot + Export)
export async function loadOOSSnapshotRows(
  snapshotId: string,
  onProgress?: (done: number, total: number) => void
): Promise<OOSRow[]> {
  const pageSize = 1000;
  const cols =
    "division, department, store_name, type_store, id_match, sku, barcode, name_la, vendor, teadterm, item_type, buying, rank_sale, store_apply, stock_store, stock_dc, remark_stock, remark_oos, ranking, core_item";
  // 1) นับจำนวนแถวก่อน
  const { count, error: cErr } = await (supabase as any)
    .from("oos_snapshot_rows").select("id", { count: "exact", head: true }).eq("snapshot_id", snapshotId);
  if (cErr) throw cErr;
  const total = count || 0;
  const pageCount = Math.ceil(total / pageSize);
  if (pageCount === 0) return [];

  // 2) ยิงทุกหน้าแบบ parallel pool
  const parts: OOSRow[][] = new Array(pageCount);
  let cursor = 0, done = 0;
  const CONCURRENCY = 8;
  const worker = async () => {
    while (true) {
      const p = cursor++;
      if (p >= pageCount) break;
      const from = p * pageSize;
      const { data, error } = await (supabase as any)
        .from("oos_snapshot_rows").select(cols)
        .eq("snapshot_id", snapshotId)
        .order("id", { ascending: true })
        .range(from, from + pageSize - 1);
      if (error) throw error;
      parts[p] = (data || []) as OOSRow[];
      done += parts[p].length;
      onProgress?.(done, total);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pageCount) }, () => worker()));
  return parts.flat();
}

// ===== Summary (คำนวณฝั่ง client จาก detail rows ที่โหลดมาแล้ว) =====
export function computeOOSSummary(rows: OOSRow[]): OOSSummary {
  // ราย store: 1 แถว = 1 sku ในสาขานั้น → COUNT = distinct sku อยู่แล้ว
  const storeMap = new Map<string, OOSStoreSummary>();
  // ราย type_store: นับ distinct sku แยกตามสถานะ
  const typeSku = new Map<
    string,
    { range: Set<string>; oos: Set<string>; have: Set<string> }
  >();
  const grandSku = { range: new Set<string>(), oos: new Set<string>(), have: new Set<string>() };

  for (const r of rows) {
    const ts = r.type_store || "(ไม่ระบุ)";
    const sKey = `${ts}|||${r.store_name}`;
    let s = storeMap.get(sKey);
    if (!s) {
      s = { type_store: ts, store_name: r.store_name, have_stock: 0, oos: 0, range: 0, pct_oos: 0 };
      storeMap.set(sKey, s);
    }
    const isOOS = r.remark_oos === "Store OOS";
    s.range++;
    if (isOOS) s.oos++;
    else s.have_stock++;

    let t = typeSku.get(ts);
    if (!t) {
      t = { range: new Set(), oos: new Set(), have: new Set() };
      typeSku.set(ts, t);
    }
    t.range.add(r.sku);
    grandSku.range.add(r.sku);
    if (isOOS) {
      t.oos.add(r.sku);
      grandSku.oos.add(r.sku);
    } else {
      t.have.add(r.sku);
      grandSku.have.add(r.sku);
    }
  }

  const stores = [...storeMap.values()]
    .map((s) => ({ ...s, pct_oos: s.range > 0 ? s.oos / s.range : 0 }))
    .sort(
      (a, b) =>
        a.type_store.localeCompare(b.type_store) || a.store_name.localeCompare(b.store_name)
    );

  // นิยาม B: Store OOS (distinct) = SKU ที่ขาดสต็อก "ทุกสาขา"
  //   = SKU ที่ range แต่ไม่มีของในสาขาไหนเลย = range − have (have = มีของ ≥1 สาขา)
  //   → have + oos = range พอดี (3 คอลัมน์ reconcile กัน)
  const totals: OOSTypeTotal[] = [...typeSku.entries()]
    .map(([type_store, v]) => ({
      type_store,
      have_stock: v.have.size,
      oos: v.range.size - v.have.size,
      range: v.range.size,
    }))
    .sort((a, b) => a.type_store.localeCompare(b.type_store));

  const grandOos = grandSku.range.size - grandSku.have.size;
  const grand = {
    have_stock: grandSku.have.size,
    oos: grandOos,
    range: grandSku.range.size,
    pct_oos: grandSku.range.size > 0 ? grandOos / grandSku.range.size : 0,
  };

  return { stores, totals, grand };
}
