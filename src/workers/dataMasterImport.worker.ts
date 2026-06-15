// Web Worker: อ่านไฟล์ xlsx ขนาดใหญ่ + แปลงหัวคอลัมน์ ใน background thread
// → จอ UI ไม่ค้าง, และ map ทีละ batch ส่งกลับ main thread แบบ flow-control
// (credit-based) เพื่อไม่ให้ batch ค้างในหน่วยความจำพร้อมกันทั้งหมด
import * as XLSX from "xlsx";
import type { TableName } from "@/lib/tableConfig";
import { buildColumnMap, mapRows } from "@/lib/importMapping";

type InMsg =
  | { type: "start"; file: File; tableName: TableName; batchSize: number }
  | { type: "pull" };

// --- credit-based backpressure: worker จะส่ง batch ถัดไปเมื่อได้ "permit" จาก main เท่านั้น
let permits = 0;
let pendingResolve: (() => void) | null = null;
const waitPermit = (): Promise<void> => {
  if (permits > 0) { permits -= 1; return Promise.resolve(); }
  return new Promise<void>((res) => { pendingResolve = res; });
};

self.onmessage = async (e: MessageEvent<InMsg>) => {
  const msg = e.data;

  if (msg.type === "pull") {
    if (pendingResolve) { const r = pendingResolve; pendingResolve = null; r(); }
    else permits += 1;
    return;
  }

  if (msg.type !== "start") return;

  try {
    const { file, tableName, batchSize } = msg;
    console.log("[worker] arrayBuffer...");
    const buffer = await file.arrayBuffer();
    console.log("[worker] XLSX.read...", (buffer.byteLength / 1048576).toFixed(1), "MB");
    const workbook = XLSX.read(buffer, { type: "array" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    console.log("[worker] sheet_to_json...");
    const rows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet);
    console.log("[worker] rows parsed:", rows.length);

    if (rows.length === 0) {
      (self as any).postMessage({ type: "done", total: 0 });
      return;
    }

    const columnMap = buildColumnMap(rows[0], tableName);
    const total = rows.length;
    (self as any).postMessage({ type: "parsed", total });

    const bs = batchSize > 0 ? batchSize : 2000;
    for (let i = 0; i < rows.length; i += bs) {
      await waitPermit(); // รอให้ main พร้อมรับ batch ถัดไป (จำกัด memory)
      const mapped = mapRows(rows.slice(i, i + bs), columnMap, tableName);
      (self as any).postMessage({ type: "batch", rows: mapped, to: Math.min(i + bs, total), total });
    }

    (self as any).postMessage({ type: "done", total });
  } catch (err: any) {
    (self as any).postMessage({ type: "error", message: err?.message || String(err) });
  }
};
