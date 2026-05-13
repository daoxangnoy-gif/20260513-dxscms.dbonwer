---
name: SRR Import Mode (Barcode/SKU)
description: SRR DC + Direct รองรับ Import Mode (Barcode/SKU + Qty) แทน Filter SPC/Vendor — Document tree แยกตามโหมด
type: feature
---
## SRR Import Mode

ทั้ง **SRR DC** และ **SRR Direct** มี toggle 2 โหมดที่ Tab "Read & Cal":

### Filter Mode (เดิม)
เลือก SPC Name → เตรียมข้อมูล → (เลือก Vendor) → Read & Cal

### Import Mode (ใหม่)
1. กด **Import Barcode/SKU** อัปโหลด `.xlsx/.csv`
   - คอลัมน์: `Barcode&SkuCode` (จำเป็น), `Qty` (optional)
   - รับทั้ง main_barcode, barcode, sku_code ผสมกันได้
   - มีปุ่ม **Template** ดาวน์โหลด
2. กด **เตรียมข้อมูล** → resolve barcode/SKU จาก data_master โดยใช้ `.or()` 3-key lookup
   - Auto-derive vendor_codes + spc_names จาก vendor_master
   - แสดง Skip Dialog ถ้ามีรายการที่ไม่เจอใน Master
3. กด **Read & Cal** → fetch RPC ตาม vendor_codes ที่ derived → filter rows ตาม imported SKU set
4. **Qty → order_uom_edit** automatic (drives FinalOrder UOM override)

### Component
`src/components/SrrImportFilter.tsx` — shared toggle + import handler + preview dialog

### State (ในแต่ละหน้า)
- `importMode: "filter" | "import"`
- `importedItems: ImportedItem[]` (key + qty)
- `importedSkuSet: Set<string>` (resolved SKUs)
- `importedQtyBySku: Map<string, number>` (sku → qty)
- `importedSkippedKeys: string[]` (ไม่เจอใน Master)

### Document Tree แยกตาม Mode (สำคัญ!)
- `VendorDocument` มี field `source: "filter" | "import"` ที่ tag ตอน Read & Cal
- `docTree` (Tab 1) filter เฉพาะ doc ที่ `source === importMode` ปัจจุบัน
- เปลี่ยน toggle Filter/Import → list document ที่เห็นจะเปลี่ยนตาม mode
- Snapshot ที่โหลดจาก DB (ไม่มี source field) default เป็น `"filter"`
- Header แสดง Badge "Filter Mode" / "Import Mode" ให้ชัดเจน
- Doc id ใส่ mode prefix: `vdoc-${importMode}-...` (DC) / `d2s-doc-${importMode}-...` (Direct) เพื่อกัน collision
