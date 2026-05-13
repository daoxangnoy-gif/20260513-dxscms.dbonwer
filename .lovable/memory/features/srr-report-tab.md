---
name: SRR Report Tab
description: Tab Report ใน SRR DC/Direct แสดงมูลค่าสั่งซื้อแยกตามสกุลเงิน
type: feature
---
Tab Report (Tab ที่ 3) ในทั้ง SRR DC และ SRR Direct:

## Component: src/components/SRRReportTab.tsx
- Prop `mode: "dc" | "direct"` — ใช้ร่วม 2 หน้า
- Source toggle: Snapshots (srr_snapshots) / Saved POs (saved_po_documents)
- Date range filter (default 30 วันล่าสุด)
- Filter: SPC (ทั้ง 2), Store + Type Store (เฉพาะ Direct)
- Currency join: vendor_master.supplier_currency by vendor_code (batched 200)

## สูตร
- DC: Σ(final_suggest_qty × po_cost_unit) ต่อ doc (date+vendor)
- Direct: Σ(final_order_qty × po_cost_unit) ต่อ store ใน doc
- ใช้ค่าหลัง edit (save แล้ว) — ไม่ recalc

## Tree
- Currency → Date → Vendor (DC จบที่ Vendor)
- Direct: Currency → Date → Vendor → Store (+type_store badge)
- แต่ละระดับมี subtotal, currency level มี grand total
