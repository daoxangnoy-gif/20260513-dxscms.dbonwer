---
name: Min/Max Calculator + Documents (3-Phase)
description: หน้า Data Control > Min/Max + Filter (Store/Type/ItemType/Buying) + Calc-with-merge-from-Doc
type: feature
---
หน้า Data Control > Min/Max ใช้ batched RPC + client merge:

**Buttons:** Calculate / Set N / Import Min/Max / Save Doc

**RPC:** `get_minmax_calc_all(p_n_factor, p_store_names[], p_type_stores[], p_item_types[], p_buying_statuses[])`
- คืน sku/store/type/size/unit_pick/avg/rank/min_cal/max_cal/item_type/buying_status
- รวม Item Type + Buying Status เพื่อใช้ filter ฝั่ง client + แสดงในตาราง
- **Range source = Range Store Doc ล่าสุด (`range_store_snapshots`)** — flatten `data[].range_data{store: {apply_yn,...}}` → ใช้เฉพาะที่ apply_yn='Y'. **ไม่อ่านจาก live `range_store` table** เพื่อกัน store/SKU ที่ยังไม่ Save Doc หลุดเข้า Calc

**Batched fetch:** `.range(0, 4999)` วนจนกว่า batch < 5000 (PostgREST จำกัด default 1000 → ใช้ range bypass)

**Filter UI:** MultiSelectFilter 4 ตัว (Store / Type Store / Item Type / Buying Status)
- options ดึงจาก RPC `get_minmax_filter_options` (item_types, buying_statuses, stores)
- กด Calculate → RPC รัน เฉพาะที่เลือก, แล้ว merge จาก Doc ล่าสุดสำหรับ key (sku|store) ที่ไม่มีใน calc
- รายการที่มาจาก Doc → แสดง Badge "Doc" + พื้นหลัง amber + Edit ช่อง min/max ไม่ได้
- Save Doc → บันทึกทั้ง 2 ส่วน (Calc ใหม่ + Doc เดิมที่ไม่ได้ Cal)

**Search:** Odoo-style chips + dropdown suggest column (SKU, Barcode, Product LA/EN, Store, Type, Size)
**Frozen header:** sticky top-0 z-10 + bg-muted + shadow-sm

**Calc ฝั่ง DB (CASE):**
- Min: avg=0 → 3, else Ceil(avg × rank_factor) (A=21,B=14,C=10,D=7)
- Max: avg=0 → unitPick≤1 ? 6 : 3+unitPick, else Ceil((Min+avg×N)/UnitPick)×UnitPick

**Doc Tab:** ตาราง snapshot + View/Export/Delete, doc แรก = Active (ใช้โดย SRR)
**Doc name:** `YYYYMMDDHHMMSS-minmaxcal`

**SRR ใช้ Doc ล่าสุด:** RPC `get_srr_data` อ่านจาก `get_latest_minmax_flat()` (Doc ล่าสุด)
`get_srr_d2s_data` อ่านจาก `minmax` table โดยตรง (เร็วกว่า jsonb)
