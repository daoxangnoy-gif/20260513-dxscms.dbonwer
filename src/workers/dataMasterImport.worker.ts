// Web Worker: อ่านไฟล์ xlsx ขนาดใหญ่ + แปลงหัวคอลัมน์ ใน background thread
// → จอ UI ไม่ค้าง, และ map ทีละ batch ส่งกลับ main thread แบบ flow-control
// (credit-based) เพื่อไม่ให้ batch ค้างในหน่วยความจำพร้อมกันทั้งหมด
import * as XLSX from "xlsx";
import type { TableName } from "@/lib/tableConfig";
import { buildColumnMap, mapRows } from "@/lib/importMapping";

type InMsg =
  | { type: "start"; file: File; tableName: TableName; batchSize: number }
  | { type: "pull" };

// อ่าน "แถวหัวคอลัมน์" แบบรองรับทั้ง sparse + dense โดยใช้ sheet_to_json อ่านทีละแถว
// เผื่อหัวตารางไม่ได้อยู่บรรทัดแรก (เช่นมีแถวว่าง/title นำหน้า) → สแกน 6 แถวแรก
const readHeaderRow = (ws: XLSX.WorkSheet): { headers: string[]; headerRowIdx: number } => {
  const ref = (ws as any)["!ref"] as string | undefined;
  if (!ref) return { headers: [], headerRowIdx: 0 };
  const range = XLSX.utils.decode_range(ref);
  const lastScan = Math.min(range.s.r + 5, range.e.r);
  for (let hr = range.s.r; hr <= lastScan; hr++) {
    const arr = (XLSX.utils.sheet_to_json(ws, {
      header: 1,
      range: { s: { r: hr, c: range.s.c }, e: { r: hr, c: range.e.c } },
      defval: null,
      blankrows: false,
    })[0] as any[]) || [];
    const nonEmpty = arr.filter((v) => v != null && String(v).trim() !== "").length;
    if (nonEmpty >= 2) return { headers: arr.map((v) => (v == null ? "" : String(v))), headerRowIdx: hr };
  }
  return { headers: [], headerRowIdx: range.s.r };
};

// ซ่อมขอบเขต (!ref) ของ sheet ที่ผู้ส่งออก (เช่น Odoo) ไม่ได้เขียน dimension มา
// → คำนวณ range จริงจากเซลล์ทั้งหมด เพื่อให้ sheet_to_json อ่านได้ (รองรับ sparse + dense)
const fixSheetRef = (ws: XLSX.WorkSheet): number => {
  const ref = (ws as any)["!ref"] as string | undefined;
  let needs = !ref;
  if (ref) {
    const r = XLSX.utils.decode_range(ref);
    if (r.e.r - r.s.r < 1) needs = true; // degenerate เช่น dimension="A1"
  }
  if (!needs) return XLSX.utils.decode_range(ref!).e.r - XLSX.utils.decode_range(ref!).s.r;

  const data = (ws as any)["!data"];
  if (Array.isArray(data)) {
    // dense mode
    let maxR = -1, maxC = 0;
    for (let r = 0; r < data.length; r++) {
      const row = data[r];
      if (!row) continue;
      if (r > maxR) maxR = r;
      if (row.length - 1 > maxC) maxC = row.length - 1;
    }
    if (maxR < 0) return 0;
    (ws as any)["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxR, c: maxC } });
    return maxR;
  }

  // sparse mode
  let minR = Infinity, minC = Infinity, maxR = -1, maxC = -1;
  for (const key in ws) {
    if (key.charCodeAt(0) === 33) continue; // ข้าม key ที่ขึ้นต้นด้วย '!'
    const cell = XLSX.utils.decode_cell(key);
    if (cell.r < minR) minR = cell.r;
    if (cell.c < minC) minC = cell.c;
    if (cell.r > maxR) maxR = cell.r;
    if (cell.c > maxC) maxC = cell.c;
  }
  if (maxR < 0) return 0;
  (ws as any)["!ref"] = XLSX.utils.encode_range({ s: { r: minR, c: minC }, e: { r: maxR, c: maxC } });
  return maxR - minR;
};

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
    const status = (phase: string) => (self as any).postMessage({ type: "status", phase });
    console.log("[worker] arrayBuffer...");
    status("กำลังโหลดไฟล์เข้าหน่วยความจำ...");
    const buffer = await file.arrayBuffer();
    console.log("[worker] XLSX.read...", (buffer.byteLength / 1048576).toFixed(1), "MB");
    status("กำลังแตกไฟล์ Excel...");
    let workbook = XLSX.read(buffer, { type: "array" });

    // วินิจฉัย: เทียบชื่อใน SheetNames กับ sheet ที่ parse ได้จริง
    console.log("[worker] SheetNames:", workbook.SheetNames);
    console.log("[worker] parsed Sheets keys:", Object.keys(workbook.Sheets));

    // ถ้า SheetJS ลิสต์ชื่อไว้ แต่ parse worksheet ไม่ออก (Sheets ว่าง/ขาด) → ลองโหมด dense
    // (ช่วยกับไฟล์ Odoo ที่ export แบบ streaming บางแบบ)
    const parsedOK = workbook.SheetNames.some((n) => workbook.Sheets[n]);
    if (!parsedOK) {
      console.warn("[worker] sparse parse ว่าง → retry dense mode");
      status("กำลังแตกไฟล์ (โหมดไฟล์ใหญ่)...");
      workbook = XLSX.read(buffer, { type: "array", dense: true } as any);
      console.log("[worker] dense Sheets keys:", Object.keys(workbook.Sheets));
    }
    status("กำลังค้นหา sheet ข้อมูล...");

    // เลือก sheet ที่ "หัวคอลัมน์ตรงกับ data_master มากสุด" (กัน pivot/summary sheet)
    // วนจาก sheet ที่ parse ได้จริง (กันเคสชื่อ key เพี้ยนจาก SheetNames)
    const realSheetNames = Object.keys(workbook.Sheets).filter((n) => n[0] !== "!");
    let bestName = realSheetNames[0];
    let bestScore = -1;
    let bestRows = -1;
    let bestHeaderRowIdx = 0;
    for (const name of realSheetNames) {
      const ws = workbook.Sheets[name];
      if (!ws) { console.log(`[worker] sheet "${name}" ว่าง`); continue; }
      const rowCnt = fixSheetRef(ws); // ซ่อม !ref ถ้าหาย/ผิด แล้วคืนจำนวนแถว
      const ref = (ws as any)["!ref"];
      if (!ref) { console.log(`[worker] sheet "${name}" ว่าง (ไม่มีเซลล์)`); continue; }
      const { headers, headerRowIdx } = readHeaderRow(ws);
      const sample: Record<string, string> = {};
      for (const h of headers) if (h.trim() !== "") sample[h] = "";
      const mapped = Object.keys(buildColumnMap(sample, tableName)).length;
      console.log(`[worker] sheet "${name}" headerRow=${headerRowIdx} cols=${headers.length} mapped=${mapped} ~rows=${rowCnt}`);
      if (mapped > bestScore || (mapped === bestScore && rowCnt > bestRows)) {
        bestScore = mapped; bestRows = rowCnt; bestName = name; bestHeaderRowIdx = headerRowIdx;
      }
    }
    console.log("[worker] using sheet:", bestName, "(mapped cols:", bestScore, "headerRow:", bestHeaderRowIdx + ")");
    if (bestScore < 2) {
      (self as any).postMessage({
        type: "error",
        message: `ไม่พบ sheet ข้อมูลสินค้า (sheet ที่มี: ${workbook.SheetNames.join(", ")})`,
      });
      return;
    }

    const sheet = workbook.Sheets[bestName];
    console.log("[worker] sheet_to_json...");
    status("กำลังแปลงข้อมูลเป็นแถว...");
    // range = headerRowIdx → ใช้แถวนั้นเป็น header และอ่าน data หลังจากนั้น (ข้ามแถว title/ว่างนำหน้า)
    const rows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { range: bestHeaderRowIdx });
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
