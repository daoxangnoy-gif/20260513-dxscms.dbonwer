---
name: Range Store Menu
description: Range Store sub-menu under Data Control. 3 tabs + Materialized View + Pre-Prepare Filter (filter-first ที่ DB) + 6 column groups + DB snapshots
type: feature
---

## Range Store

**Location**: Sub-menu ใต้ Data Control (activeTable === "range_store" → RangeStorePage)

### Database
- Table `range_store` (sku_code, store_name, apply_yn 'Y'/'N', min_display, unit_picking_super, unit_picking_mart). UNIQUE(sku_code, store_name).
- Table `range_store_snapshots` (user_id, name, data jsonb, store_list text[], item_count) — DB-persisted Save Document.
- **Materialized View `mv_range_store`**: pre-computed รวม master+status+packbox+avg_type+per_store เป็น 1 row ต่อ SKU. Hard-filtered owner='Lanexang Green Property Sole Co.,Ltd' + buying_status<>Inactive. Indexes: sku_code (unique), department, division.

### Pre-Prepare Filter (Filter-first pattern — สำคัญมาก)
- การ์ดสีเทาประบนหน้าจอ ก่อนกด Prepare → เลือก:
  - **Type Store** (Jmart/Kokkok/U-dee/...)
  - **Avg Stores** multi-select (ดึงเฉพาะ avg_per_store ของ store ที่เลือก)
  - **Range Stores** multi-select (ดึงเฉพาะ range_data ของ store ที่เลือก)
- ส่ง filter เข้า RPC `get_mv_range_store_filtered(p_avg_stores, p_range_stores, p_type_stores)` → DB กรอง jsonb keys ก่อนส่งกลับ → payload เล็กลงมาก (เร็วขึ้น 5-10 เท่า)
- ถ้าไม่เลือกอะไรเลย = ดึงทุก store (ช้า) ใช้ `get_mv_range_store` ปกติ
- RPC `get_range_store_lists()` ดึง list store + type_store มาให้เลือก (เร็ว ใช้ก่อน Prepare)

### Toolbar Buttons
- **Prepare** — ดึงจาก MV (filter-first ถ้ามี Pre-Prepare Filter). มี **ปุ่มยุด (X)** ข้าง loading indicator → AbortController ตัด batch loop
- **Refresh MV** — refresh DB view (หลัง import) แล้ว clear cache
- **Read Avg Sale / Read Range/Store** — partial reload (no-op ถ้า MV โหลดแล้ว)
- **Save All** — Merge กับ snapshot ล่าสุด: store ที่ดึงครั้งนี้ทับของเดิม, store อื่นเก็บไว้, SKU ที่ไม่อยู่ใน joined ปัจจุบันก็เก็บไว้ → snapshot ใหม่ครบทุกสาขาเสมอ
- **Clear Data**

### Column Groups (Filter Column dropdown)
1. **Master Info** (auto): div/dept/class/buyer/owner/SKU/barcode/name
2. **Barcode/Pack**: barcode_pack, pack_qty, barcode_box, box_qty, UoM
3. **Price**: standard_price, list_price
4. **Item Status**: item_status, item_type, buying_status, rank_sale
5. **Avg Sales (by Type)**: Jmart/Kokkok/Kokkok-FC/U-dee + Store Apply count
6. **Per-Store (Range)**: Range Y/N, Min Display, Avg/Day per store

### Tabs
1. **Data View**: Filters (compact toolbar) + paginated table (50/100/200/500), checkbox row selection, resizable columns
2. **Pivot + Dashboard**: Y count per Store, Department×Store matrix
3. **Save Document**: DB snapshots with double-click preview — Dialog แสดงครบทุก base columns + per-store (Y/N, Min, Avg) ทุกสาขา + ปุ่ม **Export Excel** (ครบทุก store, ใช้ใน menu อื่นต่อ)

### Filters (Snapshot pattern — ต้องกด Show)
- UI filter changes ไม่กรองทันที — เก็บไว้ใน state, กด **Show** เพื่อ commit เข้า `applied`
- **Fields** multi-select with search — pick which columns to show across selected groups (hidden via `hiddenFields`)
- **Columns** dropdown — pick column groups
- **Div Grp / Division / Dept / Sub-Dept / Class / Item Type / Buying Status / Product Owner** — multi-select with search
- **Type Store** multi-select (Jmart/Kokkok/U-dee) — narrows Store list
- **Stores** multi-select with search — only when Per-Store group active
- **Search** — chips (per-column contains) + dropdown suggestions for SKU/Barcode/Name (LA/EN)/Buyer/GM Buyer/Owner

### Selection / Pagination / Resizable columns
- Header checkbox = current page; All / This Page / Clear toolbar
- Page size 50/100/200/500
- Drag right edge of column header (min 40px), stored in module cache

### Save / Snapshots
**Save All** = entire `joined` dataset (NOT filtered). Includes range_data jsonb for all stores.

### State Persistence (module-level `cache`)
Holds: data + activeTab/search/filters/selectedGroups/selectedStores/selectedTypeStores/selectedDepartments/page/pageSize/selectedSkus/selectAllMode/colWidths/applied + **prepareFilter** (avgStores/rangeStores/typeStores) + **storeList** (cached). Tab switches preserve state; refresh resets.

### Import (Excel/CSV)
- `range`: `Barcode&SkuCode,Y/N,Min,StoreName` → upsert range_store (รับได้ทั้ง main_barcode และ sku_code; Min ใส่เข้า min_display)
- `super`: `Barcode&SkuCode,Number` → unit_picking_super for ALL stores
- `mart`: `Barcode&SkuCode,Number` → unit_picking_mart for ALL stores
- **Performance**: chunk 500 rows × parallel pool of 4 (4 batches in-flight at once). หลัง import → in-memory merge เฉพาะ SKU ที่ touch (รองรับทั้ง range/super/mart) — ไม่เรียก RPC ใหม่
- หลัง import กด **Refresh MV** เพื่อ sync view

### Clear Y/N
- Scope: Selected / Filtered / All
- **Per-store**: การ์ด CLEAR Y/N มี Stores multi-select — ว่าง = ทุกร้านค้า, เลือก = ลบเฉพาะร้านที่เลือก
- RPC `clear_range_store` รับทั้ง SKU + store filter (null = ทั้งหมด) — single batch DELETE
- **Performance**: optimistic UI — reset apply_yn='N'/min=0 ใน rangeMap + cache.perStore ทันที, ไม่ re-fetch perStore. ถ้า RPC fail → revert จาก backup snapshot

### Pastel highlights
- Range column: amber `hsl(48,96%,96%)`
- Min Display: green `hsl(142,52%,96%)`
- Avg Sales/Day: blue `hsl(210,52%,96%)`
- Row hover ใช้ Tailwind `group/group-hover` ครอบทุกคอลัมน์รวม per-store
- Min/Avg = 0 แสดงว่าง
