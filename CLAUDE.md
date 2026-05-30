# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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
