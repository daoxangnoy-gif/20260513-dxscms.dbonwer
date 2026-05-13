# Project Memory

## Core
SRR app (Jmart, Kokkok, U-dee). Supabase DB.
UI: IBM Plex font, Tailwind CSS. Clean design for heavy data tables.
Pagination: 30 rows/page default.
Join keys (item_id, sku_code, vendor_code) MUST be Text/Char to prevent mismatches.
Sidebar: User Control, Data Control, SRR, Report, Log. Do NOT re-add SRR DIRECT ITEM.
Auth: Email+Password, auto-confirm, first signup=Admin. Roles: Admin/Manager/Buyer/Viewer.

## Memories
- [Data Sources](mem://features/data-sources) — 8 core data sources (Master, Stock, Min/Max, etc.) and Excel import
- [Vendor Master](mem://features/vendor-master-details) — Vendor Code join key, fields for replenishment planning
- [Data Performance](mem://tech/data-performance) — PostgreSQL COPY, Batching for large imports to prevent timeout
- [Data Management](mem://features/data-management) — Excel import UI, inline edit, delete modes, column visibility
- [Table Filtering](mem://features/table-filtering) — Odoo-style advanced filtering, chips, modify condition dialog
- [Sales by Week Schema](mem://features/sales-by-week-schema) — Pre-calculated Avg/day, Store identifiers
- [Table Advanced UI](mem://features/table-advanced-ui) — Checkbox, auto-fit, multi-row paste, keyboard navigation
- [Pivot Tool](mem://features/pivot-tool-details) — Search, export, visible-column-only variables
- [Table Join Mapping](mem://logic/table-join-mapping) — Join keys: on_order (sku_code), sales_by_week (old_id/id18) to data_master
- [SRR Export Spec](mem://features/srr-export-spec) — PO export mapping, filename format, selected rows
- [SRR PO Management](mem://features/srr-po-management) — List Import PO tree structure (SPC -> Date -> PO)
- [Custom Table Views](mem://features/custom-table-views) — LocalStorage persistence for user-specific column views
- [SRR Page Spec](mem://features/srr-page-spec) — SRR DC ITEM UI rules, pastel highlights, truncate rules
- [Replenishment Calc](mem://logic/replenishment-calculations) — Complete SRR mathematical formulas for Gap, Suggest Qty, DOH
- [SRR Read Optimization](mem://tech/srr-read-optimization) — get_srr_data RPC, 5000-row batching, composite indexes
- [SRR Calc Behavior](mem://tech/srr-calc-runtime-behavior) — Client-side processing, Cancel Cal, srrStateRef persistence
- [SRR Selection Rules](mem://logic/srr-item-selection-rules) — Strict business filters: Packing Size=1, Active, DISTINCT sku_code
- [SRR Tab Architecture](mem://features/srr-tab-architecture) — Tab 1 (Read/Cal) and Tab 2 (Filter/Edit/Show)
- [Auth & Permission System](mem://features/auth-permission-system) — Auth + Role + Permission + Menu Control + Data Access
- [SRR Report Tab](mem://features/srr-report-tab) — Tab Report มูลค่าสั่งซื้อ แยก currency, Tree DC/Direct
