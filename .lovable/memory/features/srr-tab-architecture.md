---
name: SRR Tab Architecture
description: หน้าจอ SRR DC ITEM ใช้โครงสร้าง 2 Tab พร้อม VendorDocument tree (SPC→Date→Vendor)
type: feature
---
หน้าจอ SRR DC ITEM ใช้โครงสร้าง 2 Tab:

## Tab 1: Read & Cal
- กด Read & Cal → คำนวณทุก SPC → บันทึกแยกเป็น VendorDocument (1 doc ต่อ 1 vendor ต่อ 1 SPC ต่อ 1 วัน)
- โครงสร้าง Tree: SPC Name → Date (yyyymmdd) → Vendor
- รองรับค้นหา (Search) ในรายการ document
- Double-click ที่ Vendor เพื่อดูข้อมูล (Preview Dialog)
- Rolling 30 วัน: เก็บ document ไว้ 30 วัน ลบอัตโนมัติเมื่อเก่ากว่า
- ไม่มี Item Type filter (ย้ายไป Tab 2)

## Tab 2: Filter & Show & Edit
- มี Item Type dropdown (ย้ายมาจาก Tab 1)
- เลือก SPC, Order Day, Vendor, Item Type → กด Show
- แก้ไข Safety, Order UOM Edit → track edits กลับไปแสดงใน VendorDocument (จำนวนครั้ง, คอลัมน์ที่แก้)

## VendorDocument Model
- id, vendor_code, vendor_display, spc_name, date_key, created_at
- item_count, suggest_count, data (SRRRow[])
- edit_count, edited_columns[] (tracking edits)

## State Persistence
- ใช้ srrStateRef สำหรับ in-session persistence (vendorDocs, activeTab, page, pageSize)
