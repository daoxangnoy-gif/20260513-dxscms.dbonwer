// Doc Cost = 0 — รายการ PO ที่ po_cost_unit = 0 ตอน Export ใน List Import PO
// แยกเก็บ localStorage และ export ผ่าน DocsPopupDialog tab ใหม่
import * as XLSX from "xlsx";

export interface Cost0Row {
  Vendor: string;          // "VC - Name - CUR"
  "SKU Code": string;
  "Main barcode": string;
  "Product Name EN": string;
  "PO Cost": "";
  MOQ: "";
  "Qty Order": number;     // qty เดียวกับที่ส่งไป list import po
  // optional contextual fields used in UI/export
  _store?: string;
}

export interface Cost0Doc {
  id: string;
  name: string;
  date: string;            // ISO
  vendor_code: string;
  vendor_name: string;
  vendor_display: string;  // "VC - Name - CUR"
  spc_name: string;
  variant: "dc" | "direct";
  rows: Cost0Row[];
}

export const COST0_KEY_DC = "srr_cost0_pos";
export const COST0_KEY_D2S = "srr_cost0_pos_d2s";

export function loadCost0Docs(storageKey: string): Cost0Doc[] {
  try { return JSON.parse(localStorage.getItem(storageKey) || "[]"); } catch { return []; }
}

export function saveCost0Docs(storageKey: string, docs: Cost0Doc[]) {
  try { localStorage.setItem(storageKey, JSON.stringify(docs)); }
  catch (e) {
    if (docs.length > 20) {
      try { localStorage.setItem(storageKey, JSON.stringify(docs.slice(-20))); } catch {}
    }
    throw new Error("พื้นที่จัดเก็บเต็ม กรุณาลบ Doc Cost=0 เก่าก่อน");
  }
}

export function appendCost0Docs(storageKey: string, newDocs: Cost0Doc[]) {
  if (newDocs.length === 0) return;
  const existing = loadCost0Docs(storageKey);
  saveCost0Docs(storageKey, [...existing, ...newDocs]);
}

export function deleteCost0Docs(storageKey: string, ids: string[]) {
  const existing = loadCost0Docs(storageKey);
  saveCost0Docs(storageKey, existing.filter((d) => !ids.includes(d.id)));
}

const COST0_COLUMNS: (keyof Cost0Row)[] = [
  "Vendor", "SKU Code", "Main barcode", "Product Name EN", "PO Cost", "MOQ", "Qty Order",
];

export function exportCost0Docs(docs: Cost0Doc[]) {
  if (docs.length === 0) return;
  const wb = XLSX.utils.book_new();
  const allRows: any[] = [];
  for (const d of docs) {
    for (const r of d.rows) {
      const row: any = {};
      for (const c of COST0_COLUMNS) row[c] = (r as any)[c] ?? "";
      allRows.push(row);
    }
  }
  const ws = XLSX.utils.json_to_sheet(allRows, { header: COST0_COLUMNS as string[] });
  XLSX.utils.book_append_sheet(wb, ws, "Cost=0");
  const now = new Date();
  const ts =
    now.getFullYear().toString() +
    String(now.getMonth() + 1).padStart(2, "0") +
    String(now.getDate()).padStart(2, "0") +
    String(now.getHours()).padStart(2, "0") +
    String(now.getMinutes()).padStart(2, "0") +
    String(now.getSeconds()).padStart(2, "0");
  const fileName = docs.length === 1
    ? `${ts} - Cost0 - ${docs[0].vendor_code}.xlsx`
    : `${ts} - Cost0 - Multi.xlsx`;
  XLSX.writeFile(wb, fileName);
}

export function buildCost0Doc(params: {
  variant: "dc" | "direct";
  vendor_code: string;
  vendor_name: string;
  vendor_display: string;
  spc_name: string;
  ts: string;          // yyyymmddhhmmss
  isoDate: string;
  rows: Cost0Row[];
  suffix?: string;     // e.g. po_group / store
}): Cost0Doc {
  const sfx = params.suffix && params.suffix !== params.vendor_code ? ` (${params.suffix})` : "";
  return {
    id: `cost0-${params.variant}-${params.ts}-${params.vendor_code}-${params.suffix || ""}`,
    name: `${params.ts} - ${params.vendor_code} - ${params.vendor_name}${sfx}`,
    date: params.isoDate,
    vendor_code: params.vendor_code,
    vendor_name: params.vendor_name,
    vendor_display: params.vendor_display,
    spc_name: params.spc_name,
    variant: params.variant,
    rows: params.rows,
  };
}
