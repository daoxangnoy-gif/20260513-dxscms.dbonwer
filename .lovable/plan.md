## เป้าหมาย
ปรับ UI/วิธีดูข้อมูลของ SRR DC + SRR DIRECT ให้ Doc ถูกซ่อนไว้หลังปุ่ม "Doc" และเข้าหน้า Filter & Show & Edit ผ่านการ double-click DocNo เท่านั้น **ไม่แตะ logic การคำนวณ / Save PO / Read & Cal**

## ไฟล์ที่จะแก้
- `src/pages/SRRPage.tsx` (DC)
- `src/pages/SRRDirectPage.tsx` (DIRECT)
- `src/components/SRRReportTab.tsx` (ลบ source `saved_po`)
- `src/components/SRRReport2Tab.tsx` (ลบ option Saved POs)

---

## 1. Tab "Read & Cal" — ลบ Tree ออก

**ทั้ง DC + DIRECT:**
- ลบส่วน Tree (Date → SPC → Vendor) ที่แสดง Documents ออกทั้งหมด
- คงไว้: Mode toggle (Filter/Vendor/Barcode), filters เลือก SPC/Vendor, ปุ่ม "เตรียมข้อมูล", ปุ่ม "Read & Cal", progress bar
- หลัง Read & Cal เสร็จ: แสดง toast "✅ สำเร็จ N docs · M รายการ — กดปุ่ม Doc เพื่อดู" (ไม่แสดงรายการในหน้า)

## 2. ปุ่มใหม่ "Doc" + Dialog popup

**ตำแหน่งปุ่ม:** ขวาบนของ TabsList (ข้างๆ Date Selector) — แสดงทุก tab

**Dialog เนื้อหา:**
- TabsList ภายใน dialog: `Filter Mode | Import Vendor | Import Barcode` (ตาม mode เดิม)
- แต่ละ mode = ตาราง Doc List พร้อมคอลัมน์:

  **DC:** `☐ | Doc No | SPC Name | Vendor (code - name - cur) | SKU tt | SKU Suggest | User | [🗑]`

  **DIRECT:** `☐ | Doc No | SPC Name | Vendor | Type Store | Store | SKU tt | SKU Suggest | User | [🗑]`

- Doc No = format `created_at` เป็น `yyyymmddhhmm`
- User = ดึงจาก `user_id` ของ snapshot/doc → query `profiles.full_name` (cache เป็น Map)
- **Search per-column:** มี input filter อยู่บน header ของแต่ละคอลัมน์ (chip-style ซ้อนกันได้) — text contains case-insensitive
- มี checkbox row + ปุ่ม "Show Selected" / "Delete Selected"
- **เอา SnapshotBatchPicker (Batch วันที่) ออก** จาก toolbar หลัก — ใช้ search ในตารางแทน
- **Double-click row** → ปิด dialog + เปิดหน้า Filter & Show & Edit แสดงข้อมูล doc นั้น

## 3. หน้า Filter & Show & Edit — เปลี่ยนวิธีเข้า

- **ลบ TabsTrigger "Filter & Show & Edit"** ออกจาก TabsList
- **คงโค้ด TabsContent + ปุ่ม + filter ทุกอย่างไว้เหมือนเดิม 100%**
- เพิ่ม state `viewingDocFromPopup: boolean` — เมื่อ true ให้ render TabsContent นี้แบบ overlay/full screen หรือ setActiveTab ไปยัง hidden tab
- กลไก: Double-click DocNo → setSelectedDocIds([docId]) + showFilteredData() + เด้งไปหน้านี้
- เพิ่มปุ่ม "← กลับ" ที่หัวมุมเพื่อปิดและกลับไป Read & Cal
- **คงปุ่ม Save PO, Edit, Filter chip, Item Type filter ทุกอย่างเดิม**

## 4. Tab "List Import PO" — ปิด

- ลบ TabsTrigger "List Import PO" ออกจาก TabsList (ทั้ง DC + DIRECT)
- คง component `ListImportPO` ใน codebase ไว้ (ไม่ลบ) — เผื่อใช้ logic export
- **เพิ่มปุ่ม "Export List Import PO"** ในหน้า Filter & Show & Edit (ข้อ 3) — ใช้ logic export ของ ListImportPO เดิม โดย export rows ของ doc(s) ที่กำลังแสดงเท่านั้น

## 5. Report & Report 2 — ลบ source Saved PO

**SRRReportTab.tsx:**
- เปลี่ยน type `Source = "snapshots" | "saved_po"` → `Source = "snapshots"`
- ลบ ToggleGroupItem `saved_po` และ branch ที่ `.from("saved_po_documents")`
- คง logic snapshots ไว้

**SRRReport2Tab.tsx:**
- ลบ option/branch ที่อ่านจาก `saved_po_documents` และจาก `localStorage["srr_saved_pos*"]`
- คง option อื่น (snapshots, etc.) ไว้

**หมายเหตุ:** ไม่แตะส่วน "บันทึก/Insert saved_po_documents" ใน SRRPage/SRRDirectPage เพราะอาจมีระบบอื่นใช้

---

## สิ่งที่จะ**ไม่**แตะ
- Logic Read & Cal, calculation, RPC calls
- Save PO button + การ insert `saved_po_documents` (ในหน้า Filter & Show & Edit)
- localStorage `srr_saved_pos*`
- ListImportPO component internals
- DB schema, RLS, snapshots table

## คำถามสุดท้ายก่อนเริ่ม
1. ปุ่ม "Doc" — ใช้ icon `FolderOpen` + label `Doc (N)` (N = total docs ใน mode ปัจจุบัน) ตำแหน่งขวาของ TabsList — OK?
2. เปิด Filter & Show & Edit — ใช้แบบ **full-screen overlay** (กลบหน้า Read & Cal) มีปุ่ม "← กลับ" หัวมุม — OK?
3. Search ในตาราง Doc popup — แต่ละคอลัมน์มี input ใต้ header (chip ซ้อน AND กัน) — OK?