---
name: SRR Item Selection Rules
description: Business filters applied to SRR DC + Direct (RPC + skip enrichment). Updated Apr 2026 — added vendor_origin filter.
type: feature
---
# SRR Selection Rules (Apr 2026)

ทั้ง **SRR DC** (`get_srr_data`) และ **SRR Direct** (`get_srr_d2s_data`) ใช้เกณฑ์เดียวกัน — apply ทั้ง 3 mode (Filter / Import SKU / Import Vendor):

## Active filters (ตัดออก)
1. `data_master.product_owner = 'Lanexang Green Property Sole Co.,Ltd'`
2. `data_master.buying_status <> 'Inactive'`
3. **Vendor ต้องอยู่ใน vendor_master** — INNER JOIN `dm` ↔ `vm`
4. **`vendor_master.vendor_origin` ต้อง contains 'lao' หรือ 'thai' (ILIKE, case-insensitive)** — NULL/ว่าง ตัดออก
5. **SKU distinct** — `DISTINCT ON (sku_code) ORDER BY updated_at DESC` ใน RPC

## ❌ ยกเลิกแล้ว (ห้าม re-add):
- ~~Discontinue~~ / ~~Packing > 1~~ / ~~Consignment / trade_term~~
- ~~ไม่มีข้อมูล sales_by_week / stock~~ — LEFT JOIN

## Skip enrichment (`src/lib/srrPostReadSkip.ts`)
SKU ที่ import แล้วหายไปจาก RPC result — enrich เหตุผลตามลำดับ:
1. ไม่พบใน Master
2. ไม่ใช่ของ Lanexang
3. Inactive
4. ไม่มี Vendor Code
5. Vendor ไม่อยู่ใน Vendor Master
6. Vendor Origin ไม่ใช่ Laos/Thailand
