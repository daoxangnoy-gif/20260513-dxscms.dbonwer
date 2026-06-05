import { supabase } from "@/integrations/supabase/client";

export interface SnapshotDoc {
  id: string;
  date_key: string; // YYYY-MM-DD
  spc_name: string;
  vendor_code: string;
  vendor_display: string | null;
  item_count: number;
  suggest_count: number;
  data: any[];
  edit_count: number;
  edited_columns: string[];
  source?: "filter" | "vendor" | "import";
  user_id: string;
  created_at: string;
  updated_at: string;
}

// Get today's date key
export function getTodayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Convert old yyyymmdd to YYYY-MM-DD
export function normalizeDateKey(dk: string): string {
  if (dk.includes("-")) return dk;
  return `${dk.substring(0, 4)}-${dk.substring(4, 6)}-${dk.substring(6, 8)}`;
}

// Cutoff helper — keep only last N calendar days
function getCutoffDateKey(days = 3): string {
  const d = new Date();
  d.setDate(d.getDate() - (days - 1)); // today counts as day 1
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Auto-prune snapshots older than 3 calendar days (fire-and-forget, silent on error)
export async function pruneOldSnapshots(
  tables: ("srr_snapshots" | "srr_d2s_snapshots")[] = ["srr_snapshots", "srr_d2s_snapshots"]
): Promise<void> {
  const cutoff = getCutoffDateKey(3);
  await Promise.all(
    tables.map((t) =>
      (supabase as any).from(t).delete().lt("date_key", cutoff).then(({ error }: any) => {
        if (error) console.warn(`[pruneOldSnapshots] ${t}:`, error.message);
      })
    )
  );
}

// Get available snapshot dates (distinct date_key) — last 3 days only
export async function getSnapshotDates(): Promise<string[]> {
  const cutoff = getCutoffDateKey(3);
  const { data, error } = await supabase
    .from("srr_snapshots")
    .select("date_key")
    .gte("date_key", cutoff)
    .order("date_key", { ascending: false });
  if (error) throw error;
  const dates = [...new Set((data || []).map((r: any) => r.date_key))];
  return dates;
}

// Snapshot "batch" = unique save run, identified by created_at truncated to second.
export interface SnapshotBatch {
  /** ISO timestamp of the batch (the earliest created_at in this group, second-precision) */
  value: string;
  /** Display label "yyyymmddHHMM" (no seconds) */
  label: string;
  /** Underlying date_key for the batch */
  date_key: string;
  /** Number of documents in this batch */
  count: number;
  /** Source mode that produced this batch */
  source?: "filter" | "vendor" | "import";
}

export function formatBatchLabel(iso: string, fallbackDateKey?: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return (fallbackDateKey || iso).replace(/-/g, "").slice(0, 12);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}`;
}

export function getBatchMinuteKeyFromValue(value: string, fallbackDateKey?: string): string {
  return formatBatchLabel(value, fallbackDateKey);
}

export function buildSnapshotBatchesFromDocs(
  docs: { created_at?: string; date_key: string; source?: "filter" | "vendor" | "import" }[]
): SnapshotBatch[] {
  const groups = new Map<string, SnapshotBatch>();
  for (const doc of docs) {
    const label = formatBatchLabel(doc.created_at || doc.date_key, doc.date_key);
    const source = doc.source || "filter";
    const key = `${source}|${label}`;
    const existing = groups.get(key);
    if (existing) existing.count += 1;
    else groups.set(key, { value: doc.created_at || label, label, date_key: normalizeDateKey(doc.date_key), count: 1, source });
  }
  return [...groups.values()].sort((a, b) => b.label.localeCompare(a.label));
}

export function mergeSnapshotBatches(primary: SnapshotBatch[], secondary: SnapshotBatch[]): SnapshotBatch[] {
  const map = new Map<string, SnapshotBatch>();
  for (const b of secondary) map.set(`${b.source || "filter"}|${b.label}`, b);
  for (const b of primary) map.set(`${b.source || "filter"}|${b.label}`, b);
  return [...map.values()].sort((a, b) => b.label.localeCompare(a.label));
}

// Helper: page through query in chunks of 1000 (Supabase default cap) until all rows fetched.
// Pass a builder function that returns a fresh query, we'll apply .range() to it.
async function fetchAllPaged<T = any>(
  buildQuery: () => any,
  pageSize = 1000,
  hardCap = 100_000,
  onProgress?: (loaded: number) => void
): Promise<T[]> {
  const all: T[] = [];
  let from = 0;
  while (from < hardCap) {
    const { data, error } = await buildQuery().range(from, from + pageSize - 1);
    if (error) throw error;
    const rows = (data || []) as T[];
    all.push(...rows);
    if (onProgress) onProgress(all.length);
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

// List distinct snapshot batches (grouped by created_at to the MINUTE) within last 30 days
// Each Read & Cal run = 1 batch (all rows share the same created_at minute).
export async function getSnapshotBatches(table: "srr_snapshots" | "srr_d2s_snapshots" = "srr_snapshots"): Promise<SnapshotBatch[]> {
  const cutoffStr = getCutoffDateKey(3);
  // Page through ALL matching rows (Supabase default caps at 1000 per query)
  const data = await fetchAllPaged<any>(
    () => (supabase as any)
      .from(table)
      .select("created_at, date_key, source")
      .gte("date_key", cutoffStr)
      .order("created_at", { ascending: false }),
    1000,
    50_000 // up to 50K rows of metadata = plenty for batch grouping
  );
  const groups = new Map<string, { value: string; date_key: string; count: number; source: "filter" | "vendor" | "import" }>();
  for (const r of data) {
    const minuteKey = String(r.created_at).slice(0, 16); // "YYYY-MM-DDTHH:MM"
    const source = (r.source || "filter") as "filter" | "vendor" | "import";
    const groupKey = `${source}|${minuteKey}`;
    const existing = groups.get(groupKey);
    if (existing) existing.count++;
    else groups.set(groupKey, { value: r.created_at, date_key: r.date_key, count: 1, source });
  }
  return [...groups.values()].map(g => ({
    value: g.value,
    label: formatBatchLabel(g.value),
    date_key: g.date_key,
    count: g.count,
    source: g.source,
  }));
}

const SNAPSHOT_META_FIELDS = "id, vendor_code, vendor_display, spc_name, date_key, created_at, updated_at, item_count, suggest_count, edit_count, edited_columns, source, user_id";

// Load snapshots for a specific batch (created_at within the same MINUTE) — metadata only, data loaded lazily
export async function loadSnapshotBatch(
  createdAtIso: string,
  table: "srr_snapshots" | "srr_d2s_snapshots" = "srr_snapshots"
): Promise<any[]> {
  const start = new Date(createdAtIso);
  start.setSeconds(0, 0);
  const end = new Date(start.getTime() + 60_000);
  // Page through to support batches > 1000 docs (e.g. 1241 vendor docs in screenshot)
  const data = await fetchAllPaged<any>(
    () => (supabase as any)
      .from(table)
      .select(SNAPSHOT_META_FIELDS)
      .gte("created_at", start.toISOString())
      .lt("created_at", end.toISOString())
      .order("spc_name", { ascending: true }),
    1000,
    20_000
  );
  return data.map((r: any) => ({
    ...r,
    data: [],            // loaded on-demand via fetchSnapshotDataByIds
    edited_columns: r.edited_columns || [],
  }));
}

// Load snapshots for a specific date — metadata only, data loaded lazily
export async function loadSnapshots(dateKey: string): Promise<SnapshotDoc[]> {
  const data = await fetchAllPaged<any>(
    () => supabase
      .from("srr_snapshots")
      .select(SNAPSHOT_META_FIELDS as any)
      .eq("date_key", dateKey)
      .order("spc_name", { ascending: true }),
    1000,
    20_000
  );
  return data.map((r: any) => ({
    ...r,
    data: [],            // loaded on-demand via fetchSnapshotDataByIds
    edited_columns: r.edited_columns || [],
  })) as SnapshotDoc[];
}

// Load all snapshots within 30 days
// Load recent snapshots — metadata only (NO data column) for fast initial load
// data column is huge JSONB — only load it via loadSnapshotBatch when user actually needs it
export async function loadRecentSnapshots(onProgress?: (loaded: number) => void): Promise<SnapshotDoc[]> {
  const cutoffStr = getCutoffDateKey(3);
  const data = await fetchAllPaged<any>(
    () => (supabase as any)
      .from("srr_snapshots")
      .select("id, vendor_code, vendor_display, spc_name, date_key, created_at, item_count, suggest_count, edit_count, edited_columns, source, user_id")
      .gte("date_key", cutoffStr)
      .order("date_key", { ascending: false }),
    1000,
    20_000,
    onProgress
  );
  return data.map((r: any) => ({
    ...r,
    data: [],           // data loaded on-demand via loadSnapshotBatch
    edited_columns: r.edited_columns || [],
  })) as SnapshotDoc[];
}

// Save/upsert snapshots for a given date.
// If `createdAtIso` is provided: rows from this batch share the same created_at minute,
// and only existing rows in the SAME minute window (same SPC + source) are deleted —
// previous Read & Cal runs (different minute) are preserved as separate batches.
// If `createdAtIso` is NOT provided: legacy behavior — delete all matching SPC+source rows for the date.
export type SaveProgressFn = (info: {
  phase: "delete" | "insert";
  current: number;
  total: number;
  rowsCurrent?: number;
  rowsTotal?: number;
}) => void;

export async function saveSnapshots(
  docs: { spc_name: string; vendor_code: string; vendor_display: string; item_count: number; suggest_count: number; data: any[]; edit_count: number; edited_columns: string[]; source?: "filter" | "vendor" | "import" }[],
  userId: string,
  dateKey?: string,
  createdAtIso?: string,
  onProgress?: SaveProgressFn
): Promise<void> {
  const dk = dateKey || getTodayKey();
  const batchAt = createdAtIso ? new Date(createdAtIso) : null;
  const totalRows = docs.reduce((s, d) => s + (d.item_count || (d.data?.length || 0)), 0);

  // Compute minute window for this batch (used for both delete + insert created_at)
  let windowStartIso: string | null = null;
  let windowEndIso: string | null = null;
  if (batchAt) {
    const start = new Date(batchAt); start.setSeconds(0, 0);
    const end = new Date(start.getTime() + 60_000);
    windowStartIso = start.toISOString();
    windowEndIso = end.toISOString();
  }

  // Delete only the exact document keys being re-saved.
  // Key = date + minute window + SPC + source + vendor, so other vendors in the same minute survive.
  const pairs = [...new Set(docs.map(d => `${d.spc_name}||${d.source || "filter"}||${d.vendor_code}`))];
  let pi = 0;
  for (const pair of pairs) {
    const [spc, src, vendorCode] = pair.split("||");
    let q = (supabase as any)
      .from("srr_snapshots")
      .delete()
      .eq("date_key", dk)
      .eq("spc_name", spc)
      .eq("source", src)
      .eq("vendor_code", vendorCode);
    if (windowStartIso && windowEndIso) {
      q = q.gte("created_at", windowStartIso).lt("created_at", windowEndIso);
    }
    await q;
    pi++;
    onProgress?.({ phase: "delete", current: pi, total: pairs.length });
  }

  // Insert in batches of 50
  const batchSize = 50;
  let rowsDone = 0;
  for (let i = 0; i < docs.length; i += batchSize) {
    const slice = docs.slice(i, i + batchSize);
    const batch = slice.map(d => {
      const row: any = {
        date_key: dk,
        spc_name: d.spc_name,
        vendor_code: d.vendor_code,
        vendor_display: d.vendor_display,
        item_count: d.item_count,
        suggest_count: d.suggest_count,
        data: d.data,
        edit_count: d.edit_count,
        edited_columns: d.edited_columns,
        source: d.source || "filter",
        user_id: userId,
      };
      if (batchAt) row.created_at = batchAt.toISOString();
      return row;
    });
    const { error } = await (supabase as any).from("srr_snapshots").insert(batch);
    if (error) throw error;
    rowsDone += slice.reduce((s, d) => s + (d.item_count || (d.data?.length || 0)), 0);
    onProgress?.({
      phase: "insert",
      current: Math.min(i + batchSize, docs.length),
      total: docs.length,
      rowsCurrent: rowsDone,
      rowsTotal: totalRows,
    });
  }

}

// Fetch only the `data` field for a list of snapshot ids — used for lazy loading
export async function fetchSnapshotDataByIds(
  ids: string[],
  table: "srr_snapshots" | "srr_d2s_snapshots" = "srr_snapshots"
): Promise<Map<string, any[]>> {
  const result = new Map<string, any[]>();
  const chunkSize = 100;
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const { data, error } = await (supabase as any)
      .from(table)
      .select("id, data")
      .in("id", chunk);
    if (error) throw error;
    for (const row of data || []) result.set(row.id, row.data || []);
  }
  return result;
}

// Update a single snapshot's data (for edits)
export async function updateSnapshotData(
  snapshotId: string,
  data: any[],
  editCount: number,
  editedColumns: string[]
): Promise<void> {
  const { error } = await supabase
    .from("srr_snapshots")
    .update({ data, edit_count: editCount, edited_columns: editedColumns })
    .eq("id", snapshotId);
  if (error) throw error;
}

// Delete a snapshot
export async function deleteSnapshot(id: string): Promise<void> {
  const { error } = await supabase.from("srr_snapshots").delete().eq("id", id);
  if (error) throw error;
}

export async function deleteSnapshotsByIds(
  ids: string[],
  table: "srr_snapshots" | "srr_d2s_snapshots" = "srr_snapshots"
): Promise<{ requested: number; deleted: number }> {
  let deleted = 0;
  const chunkSize = 200;
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const { error, count } = await (supabase as any)
      .from(table)
      .delete({ count: "exact" })
      .in("id", chunk);
    if (error) throw error;
    deleted += count ?? 0;
  }
  return { requested: ids.length, deleted };
}

export async function deleteSnapshotDocuments(
  docs: { id: string; date_key: string; spc_name: string; vendor_code: string; source?: "filter" | "vendor" | "import"; created_at?: string; store_name?: string }[],
  table: "srr_snapshots" | "srr_d2s_snapshots" = "srr_snapshots"
): Promise<{ requested: number; deleted: number; deletedIds: Set<string> }> {
  const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
  let deleted = 0;
  const deletedIds = new Set<string>();
  // Fast bulk path: all docs with UUID id → 1 query per chunk of 200
  const uuidDocs = docs.filter(d => isUuid(d.id));
  const nonUuidDocs = docs.filter(d => !isUuid(d.id));
  const chunkSize = 200;
  for (let i = 0; i < uuidDocs.length; i += chunkSize) {
    const chunk = uuidDocs.slice(i, i + chunkSize);
    const ids = chunk.map(d => d.id);
    const { error, count } = await (supabase as any)
      .from(table)
      .delete({ count: "exact" })
      .in("id", ids);
    if (error) throw error;
    const c = count ?? 0;
    deleted += c;
    // If full count back, mark all as deleted; if partial, we still mark them (DB might not return exact count under RLS)
    if (c > 0 || ids.length > 0) chunk.forEach(d => deletedIds.add(d.id));
  }
  // Fallback for legacy non-UUID ids (newly calculated docs not yet reloaded)
  for (const doc of nonUuidDocs) {
    const createdAt = doc.created_at ? new Date(doc.created_at) : null;
    let q = (supabase as any)
      .from(table)
      .delete({ count: "exact" })
      .eq("date_key", normalizeDateKey(doc.date_key))
      .eq("spc_name", doc.spc_name)
      .eq("source", doc.source || "filter")
      .eq("vendor_code", doc.vendor_code);
    if (table === "srr_d2s_snapshots" && doc.store_name) q = q.eq("store_name", doc.store_name);
    if (createdAt && !isNaN(createdAt.getTime())) {
      const start = new Date(createdAt); start.setSeconds(0, 0);
      const end = new Date(start.getTime() + 60_000);
      q = q.gte("created_at", start.toISOString()).lt("created_at", end.toISOString());
    }
    const { error, count } = await q;
    if (error) throw error;
    deleted += count ?? 0;
    deletedIds.add(doc.id);
  }
  return { requested: docs.length, deleted, deletedIds };
}

// Cleanup old snapshots (> 30 days)
export async function cleanupOldSnapshots(): Promise<number> {
  const { data, error } = await supabase.rpc("cleanup_old_snapshots");
  if (error) throw error;
  return data as number;
}

// --- Saved PO Documents ---
export async function loadSavedPODocs(dateKey?: string): Promise<any[]> {
  let query = supabase.from("saved_po_documents").select("*").order("date_key", { ascending: false });
  if (dateKey) query = query.eq("date_key", dateKey);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function savePODocument(
  doc: { date_key: string; spc_name: string; vendor_code: string; vendor_display: string; po_data: any[]; item_count: number; source?: "filter" | "vendor" | "import" },
  userId: string
): Promise<void> {
  const src = doc.source || "filter";
  // Upsert by date_key + spc_name + vendor_code + source
  await supabase
    .from("saved_po_documents")
    .delete()
    .eq("date_key", doc.date_key)
    .eq("spc_name", doc.spc_name)
    .eq("vendor_code", doc.vendor_code)
    .eq("source", src);

  const { error } = await supabase.from("saved_po_documents").insert({
    ...doc,
    source: src,
    user_id: userId,
  });
  if (error) throw error;
}

export async function deletePODocument(id: string): Promise<void> {
  const { error } = await supabase.from("saved_po_documents").delete().eq("id", id);
  if (error) throw error;
}
