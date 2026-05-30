# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Working Rules

1. **แก้เฉพาะสิ่งที่สั่ง** — อย่าแก้ไขหรือปรับปรุงอื่นนอกจากที่ได้รับคำสั่ง
2. **ถามก่อนถ้าไม่แน่ใจ** — ถ้าไม่เข้าใจ requirement ให้ถามกลับก่อนเสมอ ห้ามเดาเอง
3. **สรุปทุกครั้งหลังแก้เสร็จ** — บอกว่าของเดิมมีปัญหาอะไร และแก้ไขอะไรไปบ้าง
4. **อธิบายให้เข้าใจง่าย** — อธิบายผลลัพธ์เป็นภาษาธรรมดา ไม่ใช้ศัพท์เทคนิคโดยไม่จำเป็น
5. **Auto-push ทุกครั้ง** — หลังแก้ code เสร็จทุกครั้ง ให้รัน `git add .` → `git commit` → `git push origin main` ทันที โดยไม่ต้องรอให้สั่งแยก (ยกเว้นผู้ใช้บอกว่ายังไม่ให้ push)
6. **วิเคราะห์ผลกระทบหลังแก้เสร็จ** — ทุกครั้งที่แก้ไขฟีเจอร์เสร็จ ให้วิเคราะห์ว่ามีส่วนอื่นในระบบที่เกี่ยวข้องหรือคล้ายกันไหม ถ้ามีให้เสนอว่า "มีส่วนที่เกี่ยวข้องคือ... อยากให้แก้ด้วยไหม?" แต่ห้ามแก้ให้อัตโนมัติ ต้องรอให้สั่งก่อนเสมอ

## Business Logic

### ภาพรวมระบบ

DX-SCMS เป็นระบบจัดการ Supply Chain ของธุรกิจค้าปลีก ใช้ภายในองค์กรสำหรับทีม Buyer, SPC และ Operations เพื่อคำนวณและสร้างคำสั่งซื้อสินค้าเข้าคลัง (Replenishment)

**คำศัพท์หลัก:**
- **DC** — Distribution Center (คลังกลาง)
- **SPC** — ชื่อผู้สั่งซื้อ (Purchaser) ที่รับผิดชอบ Vendor กลุ่มนั้น
- **Type Store / Store Group** — กลุ่มสาขา เช่น Jmart, Kokkok, Kokkok-fc, U-dee (แต่ละกลุ่มมีสาขาหลายแห่ง)
- **Rank Sales (A/B/C/D)** — อันดับยอดขายของสินค้า ใช้กำหนด Safety Days (A=21, B=14, C=10, D=7 วัน)
- **D2S** — Direct to Store (ส่งตรงจาก Vendor ถึงสาขา ไม่ผ่าน DC)
- **MOQ** — Minimum Order Quantity (จำนวนสั่งซื้อขั้นต่ำต่อครั้ง)

---

### Data Control

หน้าจัดการข้อมูล Master ของระบบ ใช้ import/export ข้อมูลผ่าน Excel และแก้ไขตรง UI

| ตาราง | เนื้อหา |
|-------|---------|
| `data_master` | ข้อมูลสินค้าทั้งหมด (SKU, barcode, vendor, division, ราคา, etc.) |
| `stock` | สต็อกปัจจุบันแยกตาม location/store |
| `minmax` | ค่า Min/Max แยกตาม SKU × store |
| `po_cost` | ราคาสั่งซื้อ (PO Cost) และ MOQ ของแต่ละ Vendor |
| `on_order` | สินค้าที่สั่งไปแล้วแต่ยังไม่รับของ |
| `vendor_master` | ข้อมูล Vendor (leadtime, order cycle, SPC, currency) |
| `sales_by_week` | ยอดขายรายสัปดาห์แยกตาม store |
| `rank_sales` | อันดับขายของสินค้าแต่ละรายการ |
| `range_store` | สินค้าที่ range ในแต่ละ store (pack/box qty) |

---

### Range Store (`RangeStorePage`)

กำหนดว่าสินค้ารายการไหนขายในสาขาไหนบ้าง (Product Assortment) พร้อมข้อมูลประกอบ:

- **apply_yn** — สินค้านี้ range อยู่ในสาขานั้นหรือเปล่า (Y/N)
- **pack_qty / box_qty** — จำนวนหน่วยต่อ pack และต่อ box (ใช้ใน SRR คำนวณ packsize)
- **unit_picking_super / unit_picking_mart** — หน่วยการหยิบแยกตามประเภทร้าน
- **avg sales per store group** — ยอดขายเฉลี่ยต่อวันของแต่ละ store group สำหรับสินค้านั้น

ข้อมูล pack/box จาก Range Store ถูกนำไปใช้ใน SRR DC และ SAR เพื่อแสดง Packsize และคำนวณจำนวนสั่งซื้อ

---

### Min/Max Calculation (`MinmaxCalPage`)

คำนวณค่า Min และ Max ของสินค้าแต่ละชิ้นต่อแต่ละ store โดยใช้:
- ยอดขายเฉลี่ยต่อวัน (`avg_day`)
- Rank factor ตาม Rank Sales (A/B/C/D)
- Unit Pick (จำนวนหน่วยต่อการหยิบ)

ผลลัพธ์ถูกนำไปใช้ใน SRR DC เป็น Min/Max ต่อ store group

---

### SRR DC ITEM (`SRRPage` → tab `dc_item`)

กระบวนการสั่งซื้อสินค้าเข้า DC โดยระบบคำนวณจากข้อมูลทุก store group รวมกัน

**Tab 1: Read & Cal** — ดึงข้อมูล + คำนวณ
1. เลือก Filter (SPC / Vendor / Order Day / Division / ฯลฯ) หรือ Import SKU/Vendor
2. กด "Prepare" → ดึงข้อมูลจาก Supabase RPC (`get_srr_data_json`)
3. กด "Cal" → คำนวณสูตรและบันทึกเป็น VendorDocument แยกตาม Vendor

**สูตรคำนวณ SRR DC:**
```
TT MIN       = Σ Min ทุก store group
TT Stock     = Stock DC + Σ Stock ทุก store group
TT Safety    = Leadtime + Order Cycle + Safety Days
DC Min       = avg_sales_tt × TT Safety
Gap Store    = TT MIN - TT Stock Store  (ถ้า Stock Store ≤ TT MIN)
Gap DC       = DC Min - Stock DC        (ถ้า Stock DC ≤ DC Min)
Suggest Qty  = Gap Store + Gap DC
Final Suggest = ROUNDUP(max(Suggest - On Order, 0) / MOQ) × MOQ
DOH ASIS     = TT Stock / avg_sales_tt
DOH TOBE     = (TT Stock + Final + On Order - avg_tt × leadtime) / avg_tt
```

**Tab 2: Show & Edit** — ดูและแก้ไขผลลัพธ์
- ดึง VendorDocument ที่คำนวณแล้วมาแสดง
- แก้ไขค่า Avg Sales, Min/Max, Stock, Safety, ON ORDER ได้
- ปุ่ม Clear/Restore แต่ละ field เพื่อล้างหรือคืนค่าเดิม

---

### SRR Direct Item / D2S (`SRRDirectPage`)

กระบวนการสั่งซื้อแบบ Direct to Store — Vendor ส่งสินค้าตรงถึงแต่ละสาขา ไม่ผ่าน DC

คำนวณ**ต่อ SKU × Store** (ไม่ใช่ต่อ store group) โดยใช้:
```
SRR Suggest  = IF(Stock ≤ Min, Min - Stock + Avg × OC, 0)
Final Order  = ROUNDUP(max(SRR Suggest - On Order, 0) / MOQ) × MOQ
```

---

### SAR (เบิกก่อนได้ก่อน)

ระบบคำนวณจำนวนที่แต่ละสาขาควรได้รับจาก DC โดย**มองเฉพาะว่า DC มีสต็อกพอไหม** ไม่ได้คำนวณว่าสต็อก DC จะพอแบ่งให้ทุกสาขาครบตามจำนวนหรือเปล่า (first-come-first-served)

ใช้ข้อมูล Min/Max จาก VendorDocument ของ SRR DC ร่วมกับ stock DC และ on_order ปัจจุบัน เพื่อแนะนำจำนวนที่ควรเบิก

---

### Order B2B (`SRROrderB2BPage`)

นำเข้ารหัสสินค้าและจำนวนที่ลูกค้า B2B สั่งมา (import Excel) จากนั้นดึงข้อมูลที่เกี่ยวข้อง (vendor, cost, stock) มาแสดง แล้ว Save เป็น Document แยกตามประเภทตามเงื่อนไขที่กำหนด

---

### Special Order

นำเข้ารายการสินค้าพิเศษที่ไม่อยู่ใน flow ปกติ สามารถ Save เป็น Document แยกตามประเภท (PO / RO / SO) ตามเงื่อนไขที่กำหนด

### Job Assign (`SRRJobAssignPage`)

ระบบสั่งงานและติดตามงานภายในทีม:
- หัวหน้างานสร้างและมอบหมายงานให้ลูกน้อง
- ติดตามสถานะงานว่าเสร็จหรือยัง
- เมื่อ assign งานแล้ว ระบบส่ง **WhatsApp notification** ไปหาผู้รับงานโดยอัตโนมัติ

### ส่งเอกสาร / Send Docs (`SRRSendDocsPage`)

ระบบติดตามเอกสาร PO ที่ต้องฝากส่งระหว่างจุดต่างๆ เพื่อป้องกันเอกสารสูญหาย:
- บันทึกการเดินทางของเอกสารจาก **จุด 1 → จุด 2 → จุด 3**
- นับจำนวน PO ของแต่ละ Partner ที่อยู่ในแต่ละจุด ณ ขณะนั้น
- ทำให้รู้ว่าเอกสารของ Partner ไหนอยู่ที่จุดไหน และยังค้างอยู่ที่ไหนบ้าง

### Payment Overdue

ติดตามรายการ PO ที่เกินกำหนดชำระเงิน

---

### ไหลของข้อมูลทั้งระบบ

```
[Data Control: import master data]
        ↓
[MinMax Cal: คำนวณ Min/Max ต่อ store]
        ↓
[SRR DC / D2S: Read & Cal → VendorDocuments]
        ↓
[Show & Edit: ปรับแก้ตัวเลข]
        ↓
[Save PO → List Import PO → Export Excel]
        ↓
[ส่ง PO ให้ Vendor]
```

## Commands

```bash
bun dev          # Dev server at http://localhost:8080
bun build        # Production build (base path: /20260513-dxscms.dbonwer/)
bun build:dev    # Build in development mode
bun lint         # ESLint
bun test         # Run tests once (vitest)
bun test:watch   # Watch mode
bun deploy       # Deploy to GitHub Pages (gh-pages -d dist)
```

## Architecture Overview

**DX-SCMS** is a supply-chain management SPA for a retail business. It is deployed as a static site on GitHub Pages using `HashRouter` (no server-side routing). The Supabase backend handles auth, PostgreSQL, and a single Edge Function.

### Routing & Page Shell

All navigation is state-based — there is only one URL route (`/`). `Index.tsx` owns `currentPage` and sub-menu state and renders the correct page component based on those values. `App.tsx` wraps everything in `QueryClientProvider`, `AuthProvider`, `TooltipProvider`, and `HashRouter`.

Pages: `data_control` → `DataControlPage` / `RangeStorePage` / `MinmaxCalPage` | `srr` → `SRRPage` (+ SAR sub-page) | `report` → `ReportPage` | `user_control` → `UserManagementPage` | `log` → `LogPage` / `LogPoCostPage` | `config` → `ConfigColumnExportPage` / `ConfigFilterPage`

### Auth & Permissions (`src/hooks/useAuth.tsx`)

`AuthProvider` loads user permissions via the Supabase RPC `get_user_permissions` on login. The resulting `UserPermissions` object drives all access control:

- `isAdmin` — role name `"Admin"`, bypasses all checks
- `canViewMenu(menuCode)` — menu visibility
- `canDo(menuCode, action)` — CRUD actions (`view | create | edit | delete | export | import`)
- `getColAccess(menuCode, columnKey)` — per-column access (`hidden | read | write`)
- `divisionAllowed(division, action)` — row-level division filtering
- `allowedDivisions()` — returns `Set<string> | null` (null = no restriction)

Always check `isAdmin` first; it short-circuits all permission helpers.

### Data Control (`src/hooks/useDataTable.ts`)

`useDataTable(tableName)` is the central hook for the standard data tables. It provides:
- Paginated Supabase queries (30 rows/page) with chip-based filters and full-text search
- XLSX import (500-row batches, with numeric coercion, deduplication by unique key, and retry on transient errors)
- XLSX export (full table or filtered subset, respects per-table column order)
- Inline row editing, multi-row paste from clipboard, group-by aggregation

**`src/lib/tableConfig.ts`** is the single source of truth for:
- `DATA_TABLES` — the list of DB table names and their labels
- `TABLE_COLUMNS` — ordered column arrays per table (determines export column order)
- `TABLE_UNIQUE_KEY` — upsert conflict key per table
- `COLUMN_LABELS` / `getColumnLabel()` — display labels used in export headers and import mapping

When adding a new data table, update `tableConfig.ts` first; the rest of the system derives from it.

### SRR Module (`src/pages/SRRPage.tsx`)

The most complex page. Sub-menus: DC Item, Direct Item, Special Order, Order B2B, Payment Overdue, Job Assign, Send Docs, SAR.

Key patterns:
- **Snapshot/batch system** (`src/lib/snapshotService.ts`): SRR data is imported as "snapshots" that are persisted to Supabase and loaded back in batches. `buildSnapshotBatchesFromDocs`, `mergeSnapshotBatches` handle the multi-batch assembly.
- **Import pipeline**: reads Excel → maps columns → enriches with vendor/store data from Supabase → stores snapshot. `SrrImportFilter` controls the import mode.
- **Export templates** (`src/lib/exportTemplate.ts`): column mappings stored in the `export_templates` Supabase table; `remapRowsByTemplate` applies them at export time.
- **Formula rows** (`src/lib/srrExportFormulas.ts`): `buildSRRDCFormulaRow` / `buildSheetWithFormulaRow` inject Excel formula rows into exported sheets.
- **Skip tracking** (`src/components/ImportSkipDialog.tsx`): items skipped during import (missing vendor, no store data, etc.) are collected and shown in `ImportSkipBar`.

### SAR Module (`src/pages/SARPage.tsx`)

SAR (เบิกก่อนได้ก่อน — first-import-first-out allocation). Key files:
- `src/lib/sarCalc.ts` — `SARRow` type and `computeRow()` calculation logic
- `src/lib/sarState.ts` — `sarState` singleton holds imported quantities across tabs
- `src/lib/sarExportFormulas.ts` — Excel formula row builder for SAR export
- `src/components/SAROnOrderDCTab.tsx` / `SARSkuNoOrderTab.tsx` — sub-tabs

### Range Store & Min/Max

`RangeStorePage` and `MinmaxCalPage` are standalone calculation pages. They do NOT use `useDataTable`; each fetches data directly from Supabase and manages state locally.

### Filter Templates (`src/lib/filterTemplates.ts`)

`FilterTemplate` records stored in Supabase (`filter_templates` table) are applied client-side via `applyExcludeFilters()` in `useDataTable`'s fetch pipeline. Active templates act as always-on exclude rules. Changes emit a custom event (`onFilterTemplatesUpdated`) to trigger re-fetch.

### Permission System in Supabase

- `roles` table with `menu_crud` (JSONB) and `column_permissions` (separate table)
- `role_division_access` table for division-level CRUD gating
- `user_roles` join table
- `get_user_permissions(_user_id)` RPC aggregates everything into a single response
- Edge Function `admin-update-user` (JWT-verified) handles admin user mutations

### Supabase Types

`src/integrations/supabase/types.ts` is auto-generated. Do not edit manually — regenerate via `supabase gen types typescript --project-id <id>`. The Supabase client is at `src/integrations/supabase/client.ts` and uses env vars `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`.

### UI Conventions

- All UI components live in `src/components/ui/` (shadcn/ui primitives — do not modify these).
- Custom components are in `src/components/`.
- `@` alias resolves to `src/`.
- Toast notifications: use `useToast` hook (shadcn) or `sonner` (`toast()` from `"sonner"`) — both are wired up.
- The app is Thai/Lao bilingual; UI strings may be in Thai. Product names have `_la` (Lao), `_en`, `_th` variants.

### Deployment

The `base` in `vite.config.ts` is hardcoded to `/20260513-dxscms.dbonwer/` — this must match the GitHub Pages repo name. The app uses `HashRouter` specifically because GitHub Pages does not support server-side redirect for SPA routing.
