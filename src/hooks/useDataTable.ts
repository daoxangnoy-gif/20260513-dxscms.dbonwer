import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { TableName, TABLE_COLUMNS, COLUMN_LABELS, getColumnLabel, TABLE_UNIQUE_KEY } from "@/lib/tableConfig";
import { useToast } from "@/hooks/use-toast";
import * as XLSX from "xlsx";
import { applyExcludeFilters, onFilterTemplatesUpdated } from "@/lib/filterTemplates";

export interface SheetInfo {
  name: string;
  index: number;
}

export type FilterOperator = "contains" | "=" | "!=" | "starts_with" | "ends_with" | "is_set" | "is_not_set";

export interface SearchFilter {
  column: string;
  operator: FilterOperator;
  value: string;
}

export const OPERATOR_LABELS: Record<FilterOperator, string> = {
  "contains": "contains",
  "=": "=",
  "!=": "!=",
  "starts_with": "starts with",
  "ends_with": "ends with",
  "is_set": "is set",
  "is_not_set": "is not set",
};

export function useDataTable(tableName: TableName) {
  const [data, setData] = useState<Record<string, any>[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [importProgress, setImportProgress] = useState<{ current: number; total: number; phase: string } | null>(null);
  const [page, setPage] = useState(0);
  const [searchColumns, setSearchColumns] = useState<string[]>([]);
  const [searchValue, setSearchValue] = useState("");
  const [filters, setFilters] = useState<SearchFilter[]>([]);
  const [editingRow, setEditingRow] = useState<string | null>(null);
  const [editedData, setEditedData] = useState<Record<string, any>>({});
  const { toast } = useToast();
  const pageSize = 30;

  const clearSidebarCountCache = () => {
    try { sessionStorage.removeItem("sidebar_table_counts"); } catch {}
  };

  const columns = TABLE_COLUMNS[tableName];

  // Reset search/filter state when switching to a different table (menu)
  useEffect(() => {
    setSearchValue("");
    setSearchColumns([]);
    setFilters([]);
    setPage(0);
    setEditingRow(null);
    setEditedData({});
  }, [tableName]);

  // Apply current chip-filters / quick search to a supabase query builder
  const applyChipFilters = (query: any) => {
    for (const f of filters) {
      switch (f.operator) {
        case "contains":
          query = query.ilike(f.column, `%${f.value}%`);
          break;
        case "=":
          query = query.eq(f.column, f.value);
          break;
        case "!=":
          query = query.neq(f.column, f.value);
          break;
        case "starts_with":
          query = query.ilike(f.column, `${f.value}%`);
          break;
        case "ends_with":
          query = query.ilike(f.column, `%${f.value}`);
          break;
        case "is_set":
          query = query.not(f.column, "is", null);
          break;
        case "is_not_set":
          query = query.is(f.column, null);
          break;
      }
    }
    if (filters.length === 0 && searchValue) {
      const searchCols = searchColumns.length > 0 ? searchColumns : columns.slice(0, 5);
      const orFilter = searchCols.map(col => `${col}.ilike.%${searchValue}%`).join(",");
      query = query.or(orFilter);
    }
    return query;
  };

  const fetchData = async () => {
    setLoading(true);
    try {
      let query: any = supabase.from(tableName).select("*", { count: "planned" });
      query = applyChipFilters(query);
      const { data: rows, count, error } = await query.range(page * pageSize, (page + 1) * pageSize - 1);
      if (error) throw error;
      const filtered = await applyExcludeFilters((rows || []) as any[], tableName);
      setData(filtered);
      setTotalCount((count || 0) - (((rows || []).length) - filtered.length));
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  // Fetch ALL rows matching the current chip-filters (paginated)
  const fetchAllByFilters = async (): Promise<Record<string, any>[]> => {
    const all: Record<string, any>[] = [];
    const fetchSize = 1000;
    let offset = 0;
    while (true) {
      let query: any = supabase.from(tableName).select("*");
      query = applyChipFilters(query);
      const { data: rows, error } = await query.range(offset, offset + fetchSize - 1);
      if (error) throw error;
      if (!rows || rows.length === 0) break;
      all.push(...rows);
      if (rows.length < fetchSize) break;
      offset += fetchSize;
    }
    return all;
  };


  // Re-fetch when filter templates change
  useEffect(() => {
    return onFilterTemplatesUpdated(() => { fetchData(); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableName]);

  const addFilter = (filter: SearchFilter) => {
    setFilters(prev => [...prev, filter]);
  };

  const removeFilter = (index: number) => {
    setFilters(prev => prev.filter((_, i) => i !== index));
  };

  const updateFilter = (index: number, filter: SearchFilter) => {
    setFilters(prev => prev.map((f, i) => i === index ? filter : f));
  };

  const clearFilters = () => {
    setFilters([]);
    setSearchValue("");
  };

  const getSheets = async (file: File): Promise<SheetInfo[]> => {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array" });
    return workbook.SheetNames.map((name, index) => ({ name, index }));
  };

  const importData = async (file: File, mode: "insert" | "update" = "insert", sheetIndex = 0) => {
    setLoading(true);
    setImportProgress({ current: 0, total: 0, phase: "กำลังอ่านไฟล์..." });
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const sheet = workbook.Sheets[workbook.SheetNames[sheetIndex]];
      const jsonData = XLSX.utils.sheet_to_json<Record<string, any>>(sheet);

      if (jsonData.length === 0) {
        toast({ title: "ไม่พบข้อมูล", description: "ไฟล์ไม่มีข้อมูล", variant: "destructive" });
        return;
      }

      const columnMap = buildColumnMap(jsonData[0], tableName);
      // stock มี row มากและ payload หนัก ลด batch size เพื่อป้องกัน connection timeout
      const BATCH_SIZES: Partial<Record<string, number>> = { stock: 200 };
      const batchSize = BATCH_SIZES[tableName] ?? 500;
      const totalBatches = Math.ceil(jsonData.length / batchSize);
      let processed = 0;
      setImportProgress({ current: 0, total: jsonData.length, phase: "กำลังนำเข้า" });

      // Numeric columns per table — values must be coerced from Excel booleans/strings to number|null
      const NUMERIC_COLS: Record<string, Set<string>> = {
        stock: new Set(["inventoried_quantity", "quantity", "on_hand", "reserved_quantity", "values_amount"]),
        data_master: new Set([
          "weight", "width", "depth", "height", "min_display", "max_display",
          "packing_size_qty", "tax_rate", "excise_tax", "import_tax",
          "min_order_pcs", "dc_min_stock", "standard_price", "list_price", "jmart_price",
        ]),
        minmax: new Set(["min_val", "max_val"]),
        po_cost: new Set(["moq", "po_cost_unit", "po_cost"]),
        on_order: new Set(["po_qty"]),
        sales_by_week: new Set(["avg_day"]),
        vendor_master: new Set(["leadtime", "order_cycle"]),
      };
      const numericSet = NUMERIC_COLS[tableName] || new Set();

      const coerceValue = (dbCol: string, val: any): any => {
        if (val === undefined || val === null || val === "") return null;
        if (numericSet.has(dbCol)) {
          if (typeof val === "boolean") return val ? 1 : 0;
          const s = String(val).trim().toLowerCase();
          if (s === "" || s === "false" || s === "no" || s === "n/a" || s === "-") return null;
          if (s === "true" || s === "yes") return 1;
          const n = Number(s.replace(/,/g, ""));
          return Number.isFinite(n) ? n : null;
        }
        if (typeof val === "boolean") return val ? "Y" : "N";
        return val;
      };

      // Helper: dedupe a batch by unique key (keep LAST occurrence — same as Excel "latest wins")
      const dedupeByKey = (rows: Record<string, any>[], key: string) => {
        const map = new Map<string, Record<string, any>>();
        for (const r of rows) {
          const k = r[key];
          if (k === undefined || k === null || k === "") continue;
          map.set(String(k), r);
        }
        return Array.from(map.values());
      };

      // Helper: upsert with retry + exponential backoff สำหรับ transient network errors
      // attempt 1 = ครั้งแรก, retry สูงสุด 6 ครั้ง (รอ 1s, 2s, 4s, 8s, 16s, 30s)
      const upsertWithRetry = async (rows: any[], opts: any, attempt = 1): Promise<void> => {
        const { error } = await supabase.from(tableName).upsert(rows, opts);
        if (!error) return;
        const msg = (error.message || "") + (error.code || "");
        const transient = /fetch|network|timeout|503|504|ECONN|gateway|reset|abort/i.test(msg);
        if (transient && attempt <= 6) {
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 30000); // 1s→2s→4s→8s→16s→30s
          await new Promise(r => setTimeout(r, delay));
          return upsertWithRetry(rows, opts, attempt + 1);
        }
        throw error;
      };

      let batchIdx = 0;
      const uniqueKey = TABLE_UNIQUE_KEY[tableName];

      // Global dedupe across whole file when using a business unique key — prevents
      // "ON CONFLICT cannot affect row a second time" at 10k+ rows when duplicates
      // span batch boundaries. Keep LAST occurrence (latest wins).
      let workingData = jsonData;
      if (uniqueKey && (mode === "update" || mode === "insert")) {
        // We need to map first to know the key value, then dedupe by mapped key.
        // Cheap: rely on the same dedupeByKey after mapping inside the loop. But to
        // also prevent cross-batch duplicates, do a pre-pass that maps just the key.
        const keyExcelCol = Object.entries(columnMap).find(([, db]) => db === uniqueKey)?.[0];
        if (keyExcelCol) {
          const seen = new Map<string, Record<string, any>>();
          for (const row of jsonData) {
            const k = row[keyExcelCol];
            if (k === undefined || k === null || k === "") continue;
            seen.set(String(k).trim(), row);
          }
          workingData = Array.from(seen.values());
          if (workingData.length !== jsonData.length) {
            console.log(`[Import] Deduped ${jsonData.length - workingData.length} duplicate ${uniqueKey} rows`);
          }
        }
      }

      const totalAfterDedupe = workingData.length;
      const totalBatchesAfter = Math.ceil(totalAfterDedupe / batchSize);
      setImportProgress({ current: 0, total: totalAfterDedupe, phase: "กำลังนำเข้า" });

      for (let i = 0; i < workingData.length; i += batchSize) {
        batchIdx++;
        const batch = workingData.slice(i, i + batchSize).map(row => {
          const mapped: Record<string, any> = {};
          for (const [excelCol, dbCol] of Object.entries(columnMap)) {
            if (dbCol && row[excelCol] !== undefined) {
              const coerced = coerceValue(dbCol, row[excelCol]);
              if (coerced !== null && coerced !== undefined) mapped[dbCol] = coerced;
            }
          }
          return mapped;
        }).filter(row => Object.keys(row).length > 0);

        if (batch.length > 0) {
          if (mode === "update" && tableName === "data_master") {
            // data_master uses composite key: sku_code + main_barcode + barcode.
            for (const row of batch) {
              const sku = row.sku_code;
              const mb = row.main_barcode;
              const bc = row.barcode;
              if (!sku || !mb || !bc) continue;
              const updateData: Record<string, any> = { ...row };
              delete updateData.sku_code;
              delete updateData.main_barcode;
              delete updateData.barcode;
              if (Object.keys(updateData).length === 0) continue;
              const { error } = await supabase
                .from("data_master")
                .update(updateData as any)
                .eq("sku_code", sku)
                .eq("main_barcode", mb)
                .eq("barcode", bc);
              if (error) throw error;
            }
          } else if (mode === "update") {
            const finalBatch = uniqueKey ? dedupeByKey(batch, uniqueKey) : batch;
            await upsertWithRetry(finalBatch, { onConflict: uniqueKey || "id", ignoreDuplicates: false });
          } else if (uniqueKey) {
            const finalBatch = dedupeByKey(batch, uniqueKey);
            await upsertWithRetry(finalBatch, { onConflict: uniqueKey, ignoreDuplicates: false });
          } else {
            const { error } = await supabase.from(tableName).insert(batch as any);
            if (error) throw error;
          }
          processed += batch.length;
          // พักระหว่าง batch ให้ server หายใจได้ ป้องกัน connection drop เมื่อ import ข้อมูลจำนวนมาก
          if (i + batchSize < workingData.length) {
            await new Promise(r => setTimeout(r, 120));
          }
        }
        setImportProgress({
          current: processed,
          total: totalAfterDedupe,
          phase: `Batch ${batchIdx}/${totalBatchesAfter}`,
        });
      }

      toast({ title: `${mode === "update" ? "Update" : "Import"} สำเร็จ`, description: `ประมวลผล ${processed} แถว` });
      clearSidebarCountCache();
      await fetchData();
    } catch (err: any) {
      toast({ title: "Import Error", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
      setImportProgress(null);
    }
  };

  const exportData = async (selectedIds?: string[]) => {
    try {
      let allData: Record<string, any>[] = [];
      
      if (selectedIds && selectedIds.length > 0) {
        // Export selected rows only
        const batchSize = 50;
        for (let i = 0; i < selectedIds.length; i += batchSize) {
          const batch = selectedIds.slice(i, i + batchSize);
          const { data: rows, error } = await supabase.from(tableName).select("*").in("id", batch);
          if (error) throw error;
          allData.push(...(rows || []));
        }
      } else {
        // Export ALL data using pagination to bypass 1000 row limit
        const fetchSize = 1000;
        let offset = 0;
        let hasMore = true;
        while (hasMore) {
          const { data: rows, error } = await supabase
            .from(tableName)
            .select("*")
            .range(offset, offset + fetchSize - 1);
          if (error) throw error;
          if (!rows || rows.length === 0) {
            hasMore = false;
          } else {
            allData.push(...rows);
            offset += fetchSize;
            if (rows.length < fetchSize) hasMore = false;
          }
        }
      }

      const exportRows = allData.map(row => {
        const mapped: Record<string, any> = {};
        for (const col of columns) {
          mapped[getColumnLabel(col, tableName)] = row[col];
        }
        return mapped;
      });
      if (exportRows.length === 0) {
        const header: Record<string, any> = {};
        for (const col of columns) { header[getColumnLabel(col, tableName)] = ""; }
        exportRows.push(header);
      }
      const ws = XLSX.utils.json_to_sheet(exportRows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, tableName);
      XLSX.writeFile(wb, `${tableName}_export.xlsx`);
      toast({ title: "Export สำเร็จ", description: `${allData.length} แถว` });

      // Log EXPORT activity for po_cost table
      if (tableName === "po_cost") {
        try {
          const { data: userData } = await supabase.auth.getUser();
          const u = userData?.user;
          await supabase.from("po_cost_log").insert({
            activity: "EXPORT",
            user_id: u?.id ?? null,
            user_email: u?.email ?? null,
            changes: {
              rows_exported: { old: null, new: allData.length },
              scope: { old: null, new: selectedIds && selectedIds.length > 0 ? "selected" : "all" },
            },
          });
        } catch (e) {
          console.error("Failed to log po_cost EXPORT", e);
        }
      }
    } catch (err: any) {
      toast({ title: "Export Error", description: err.message, variant: "destructive" });
    }
  };

  const exportTemplate = () => {
    const header: Record<string, any> = {};
    for (const col of columns) { header[getColumnLabel(col, tableName)] = ""; }
    const ws = XLSX.utils.json_to_sheet([header]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, tableName);
    XLSX.writeFile(wb, `${tableName}_template.xlsx`);
    toast({ title: "Template Export สำเร็จ" });
  };

  const clearUI = () => { setData([]); setTotalCount(0); setPage(0); };

  const deleteAll = async () => {
    try {
      const { error } = await supabase.from(tableName).delete().neq("id", "00000000-0000-0000-0000-000000000000");
      if (error) throw error;
      toast({ title: "ลบข้อมูลสำเร็จ" });
      clearSidebarCountCache();
      setData([]); setTotalCount(0);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  // Export rows matching current filter chips / quick search
  const exportByFilters = async () => {
    try {
      const allData = await fetchAllByFilters();
      const exportRows = allData.map(row => {
        const mapped: Record<string, any> = {};
        for (const col of columns) mapped[getColumnLabel(col, tableName)] = row[col];
        return mapped;
      });
      if (exportRows.length === 0) {
        const header: Record<string, any> = {};
        for (const col of columns) header[getColumnLabel(col, tableName)] = "";
        exportRows.push(header);
      }
      const ws = XLSX.utils.json_to_sheet(exportRows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, tableName);
      XLSX.writeFile(wb, `${tableName}_filtered.xlsx`);
      toast({ title: "Export สำเร็จ", description: `${allData.length} แถว` });
    } catch (err: any) {
      toast({ title: "Export Error", description: err.message, variant: "destructive" });
    }
  };

  // Delete rows matching current filter chips / quick search
  const deleteByFilters = async () => {
    try {
      const allData = await fetchAllByFilters();
      const ids = allData.map(r => r.id).filter(Boolean) as string[];
      if (ids.length === 0) {
        toast({ title: "ไม่มีข้อมูลที่ตรง Filter", variant: "destructive" });
        return;
      }
      const chunk = 500;
      for (let i = 0; i < ids.length; i += chunk) {
        const { error } = await supabase.from(tableName).delete().in("id", ids.slice(i, i + chunk));
        if (error) throw error;
      }
      toast({ title: "ลบสำเร็จ", description: `${ids.length} แถว` });
      clearSidebarCountCache();
      await fetchData();
    } catch (err: any) {
      toast({ title: "Delete Error", description: err.message, variant: "destructive" });
    }
  };


  const startEditing = (rowId: string) => {
    const row = data.find(r => r.id === rowId);
    if (row) { setEditingRow(rowId); setEditedData({ ...row }); }
  };

  const cancelEditing = () => { setEditingRow(null); setEditedData({}); };

  const saveEditing = async () => {
    if (!editingRow) return;
    try {
      const updateData: Record<string, any> = {};
      for (const col of columns) {
        if (editedData[col] !== undefined) updateData[col] = editedData[col];
      }
      const { error } = await supabase.from(tableName).update(updateData as any).eq("id", editingRow);
      if (error) throw error;
      toast({ title: "บันทึกสำเร็จ" });
      clearSidebarCountCache();
      setEditingRow(null); setEditedData({});
      await fetchData();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const updateEditedField = (col: string, value: any) => {
    setEditedData(prev => ({ ...prev, [col]: value }));
  };

  const pasteToRows = async (selectedIds: string[], clipText: string) => {
    const rows = clipText.split("\n").filter(r => r.trim()).map(r => r.split("\t"));
    let updated = 0;
    for (let i = 0; i < Math.min(rows.length, selectedIds.length); i++) {
      const rowId = selectedIds[i];
      const values = rows[i];
      const updateData: Record<string, any> = {};
      columns.forEach((col, colIdx) => {
        if (colIdx < values.length && values[colIdx]?.trim() !== "") {
          updateData[col] = values[colIdx];
        }
      });
      if (Object.keys(updateData).length > 0) {
        const { error } = await supabase.from(tableName).update(updateData as any).eq("id", rowId);
        if (!error) updated++;
      }
    }
    if (updated > 0) {
      toast({ title: "วางข้อมูลสำเร็จ", description: `อัปเดต ${updated} แถว` });
      await fetchData();
    }
  };

  const groupByColumn = async (groupCol: string, valueCol: string, aggType: "count" | "sum" | "avg" = "count") => {
    try {
      const { data: allData, error } = await supabase.from(tableName).select(`${groupCol}, ${valueCol}`).limit(10000);
      if (error) throw error;
      const groups: Record<string, number[]> = {};
      for (const row of allData || []) {
        const key = String(row[groupCol] ?? "(ว่าง)");
        if (!groups[key]) groups[key] = [];
        groups[key].push(Number(row[valueCol]) || 0);
      }
      const result = Object.entries(groups).map(([key, vals]) => ({
        [groupCol]: key,
        count: vals.length,
        sum: vals.reduce((a, b) => a + b, 0),
        avg: vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0,
      }));
      return result.sort((a, b) => b.count - a.count);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
      return [];
    }
  };

  return {
    data, totalCount, loading, importProgress, page, setPage, pageSize, columns,
    searchColumns, setSearchColumns, searchValue, setSearchValue,
    filters, addFilter, removeFilter, updateFilter, clearFilters,
    fetchData, getSheets, importData, exportData, exportByFilters, exportTemplate, clearUI, deleteAll, deleteByFilters,
    editingRow, editedData, startEditing, cancelEditing, saveEditing, updateEditedField,
    pasteToRows, groupByColumn,
    setData, setTotalCount,
  };
}

function buildColumnMap(sampleRow: Record<string, any>, tableName: TableName): Record<string, string> {
  const excelHeaders = Object.keys(sampleRow);
  const dbColumns = TABLE_COLUMNS[tableName];
  const dbSet = new Set<string>(dbColumns);

  // Build reverse map: label -> dbCol (so headers exported by our Template round-trip 1:1)
  const norm = (s: string) => String(s ?? "").toLowerCase().trim()
    .replace(/[()]/g, "")
    .replace(/[\s\/\-\.]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");

  const labelToCol: Record<string, string> = {};
  for (const col of dbColumns) {
    const label = getColumnLabel(col, tableName);
    labelToCol[norm(label)] = col;
    labelToCol[norm(col)] = col;
  }

  const specialMappings: Record<string, string> = {
    skucode: "sku_code",
    product_name_la: "product_name_la", product_name_en: "product_name_en",
    product_name_th: "product_name_th", product_name_kr: "product_name_kr",
    product_name_cn: "product_name_cn",
    unit_of_measure_name: "unit_of_measure",
    packaging_depth: "depth",
    seller_ids_vendor_code: "vendor_code",
    seller_ids_display_name: "vendor_display_name",
    vendor_name: "vendor_display_name",
    discontinue_action_code_code: "discontinue_action_code",
    valuation_by_lot_serial_number: "valuation_by_lot",
    create_po_pos: "create_purchase_order_pos",
    create_purchase_order_pos: "create_purchase_order_pos",
    min: "min_val", max: "max_val", "1x": "moq",
    product_name2: "product_name",
    type: "product_type",
    sub_department_code: "sub_department_code",
    sub_department: "sub_department",
    sub_class_code: "sub_class_code",
    sub_class: "sub_class",
    jmart_price: "jmart_price",
  };

  const map: Record<string, string> = {};
  for (const header of excelHeaders) {
    const n = norm(header);
    if (labelToCol[n]) { map[header] = labelToCol[n]; continue; }
    if (dbSet.has(n)) { map[header] = n; continue; }
    if (specialMappings[n] && dbSet.has(specialMappings[n])) { map[header] = specialMappings[n]; continue; }
    // Last resort fuzzy (only when target column is not ambiguous)
    const candidates = dbColumns.filter(col => col === n || n === col);
    if (candidates.length === 1) { map[header] = candidates[0]; continue; }
    // Try includes only if exactly one candidate matches
    const includes = dbColumns.filter(col => n === col || (n.length > 4 && col.length > 4 && (n === col)));
    if (includes.length === 1) { map[header] = includes[0]; }
  }
  return map;
}
