## เป้าหมาย
สร้างระบบ **Default Filter (Exclude rule)** แบบ Global ที่ตั้งใน Config > Config Filter แล้ว apply อัตโนมัติเวลาดึงข้อมูลในทุกหน้าที่มี Filter

---

## หน้าที่ครอบคลุม (ตรวจสอบแล้ว)
หน้าเหล่านี้มีการ Filter ดึงข้อมูล:
1. **Data Control** — Data Master, Stock, MinMax, PO Cost, On Order, Rank Sales, Sales By Week, Vendor Master, Store Type, Customers (table `data_master`, `stock`, `minmax`, `po_cost`, `on_order`, `rank_sales`, `sales_by_week`, `range_store`, `store_type`, `customers`)
2. **Range Store** (table `range_store_view`)
3. **MinMax Cal** (table `data_master` + `sales_by_week`)
4. **SRR DC** (table `data_master` + `stock` + `on_order`)
5. **SRR Direct (D2S)** (table `data_master` + `stock` + `on_order`)
6. **SRR Special Order** (table `data_master`)
7. **SAR** (table `minmax_cal_documents` + `data_master` + `stock` + `on_order_dc`)

---

## โครงสร้าง Database (Migration ใหม่)

ตาราง `filter_templates` (Global, Admin จัดการ):
- `id`, `name` ชื่อ template, `target_table` ตารางเป้าหมาย (เช่น `data_master`, `stock`)
- `is_active` boolean เปิด/ปิด template
- `rules` jsonb — array ของ rule + logic
  ```
  [
    { "column": "buying_status", "operator": "is_in",    "value": ["X","Y"], "join": "AND" },
    { "column": "item_status",   "operator": "not_in",   "value": ["Inactive"], "join": "OR" },
    { "column": "product_name",  "operator": "contains", "value": "TEST",       "join": "AND" }
  ]
  ```
- Operators รองรับ: `is_in`, `not_in`, `contains`, `not_contains`, `equals`, `not_equals`, `is_empty`, `is_not_empty`
- `created_by`, `created_at`, `updated_at`
- RLS: SELECT ทุก authenticated, INSERT/UPDATE/DELETE เฉพาะ Admin

---

## UI ใหม่

### 1. ปรับ Sidebar
เมนู **Config** กลายเป็น parent มี sub-menu (เหมือน Data Control):
- **Config - Column Export** (ของเดิม `ConfigColumnExportPage`)
- **Config - Filter** (ใหม่)

### 2. หน้า `ConfigFilterPage.tsx` ใหม่
- ตารางรายการ Template (ชื่อ, ตาราง, จำนวน rule, สถานะ on/off, ปุ่มแก้/ลบ)
- ปุ่ม "+ New Template" เปิด Dialog
- Dialog Form:
  1. **Name** — ชื่อ template
  2. **Target Table** — dropdown จากรายการตารางข้างบน
  3. **Active** — toggle
  4. **Rules** — list ที่เพิ่มได้ต่อเนื่อง แต่ละบรรทัด:
     - Column (dropdown จาก schema ของตารางนั้น)
     - Operator (is_in / not_in / contains / not_contains / equals / not_equals / is_empty / is_not_empty)
     - Value (text input หรือ tag input สำหรับ is_in/not_in)
     - Join (AND/OR) ระหว่าง rule (rule แรกไม่มี)
  5. ปุ่ม **+ Add Rule**, ลบ rule, Save, Cancel

### 3. Runtime helper `src/lib/filterTemplates.ts`
- `loadActiveFilterTemplates(table)` — ดึง template active ของตารางนั้นจาก DB (cache in-memory + invalidation event)
- `applyExcludeFilters<T>(rows, table)` — รับ array แล้วกรอง row ที่ "match" rule ออก (เพราะเป็น Exclude template)
- `applyExcludeFiltersToQuery(query, table)` — สำหรับ supabase query builder (ใช้ `.not()`, `.in()`, `.ilike()` เป็นต้น) เพื่อกรองตั้งแต่ระดับ DB
- ส่ง event `filter-templates-updated` เมื่อ Config Filter บันทึก → หน้าอื่นๆ refresh cache

### 4. Integration กับหน้าเดิม
ในแต่ละหน้าข้างบน หลัง fetch ข้อมูล (และก่อน setRows) ให้เรียก:
```ts
const filtered = await applyExcludeFilters(rows, "data_master");
```
หรือถ้าเป็น Supabase query โดยตรง ใส่ `.not(...)` ผ่าน helper ก่อน execute

---

## เทคนิค

- ไฟล์ใหม่:
  - `src/pages/ConfigFilterPage.tsx` — UI หลัก
  - `src/components/FilterRuleEditor.tsx` — Dialog form
  - `src/lib/filterTemplates.ts` — runtime helper + cache
- ไฟล์แก้:
  - `src/components/AppSidebar.tsx` — ทำ Config เป็น expandable parent + sub-menus
  - `src/pages/Index.tsx` — เพิ่ม state `activeConfigSub` + routing config sub
  - `src/pages/{SRRPage, SRRDirectPage, SRRSpecialOrderPage, SARPage, RangeStorePage, MinmaxCalPage, DataControlPage}.tsx` — apply exclude filter หลัง fetch
- Schema source: hard-coded list ของ column ที่ filter ได้ ต่อ table (ใน `filterTemplates.ts`) — เพื่อ dropdown Column

---

## สิ่งที่จะ **ไม่** ทำ
- ไม่แก้ business logic ของแต่ละหน้า (คำนวน, save snapshot, export) นอกจาก step "หลัง fetch → apply exclude"
- ไม่ทำ Per-User filter (Global เท่านั้นตามที่ตอบ)
- ไม่ทำ Manual Toggle ฝั่ง user (Auto-apply เท่านั้น)

---

## ผลลัพธ์ที่ User เห็น
1. Sidebar เมนู Config ขยายได้ มี 2 sub
2. หน้า Config Filter — สร้าง/แก้/ลบ template ได้
3. Template active → ทุกหน้าที่ดึงข้อมูลจาก table นั้น จะ **ไม่แสดง** row ที่ตรง rule
4. Refresh ทันทีที่ Save (ไม่ต้อง reload หน้า)

อนุมัติแผนนี้ไหมครับ? ถ้าโอเค ผมจะเริ่มทำ migration ก่อน แล้วค่อยทำ UI