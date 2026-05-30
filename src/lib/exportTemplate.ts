import { supabase } from "@/integrations/supabase/client";

export type TargetMenu =
  | "srr_dc_po"
  | "srr_d2s_po"
  | "srr_special_po"
  | "srr_special_ro"
  | "srr_special_so";

export const TARGET_MENUS: { value: TargetMenu; label: string }[] = [
  { value: "srr_dc_po", label: "SRR DC — List Import PO" },
  { value: "srr_d2s_po", label: "SRR Direct — List Import PO (D2S)" },
  { value: "srr_special_po", label: "SRR Special — PO" },
  { value: "srr_special_ro", label: "SRR Special — RO" },
  { value: "srr_special_so", label: "SRR Special — SO" },
];

// "field" = use Data From source; legacy "all_row"/"first_row" are treated as "field" with matching scope.
export type ConditionType = "field" | "constant" | "conditional" | "all_row" | "first_row";

export type RowScope = "all_row" | "first_row";

export interface ColumnSource {
  table: string; // "srr_row" | "data_master" | "vendor_master" | "po_cost" | "store_type"
  field: string;
}

export interface ColumnCondition {
  type: ConditionType;
  scope?: RowScope;        // independent: where to print (default all_row)
  value?: string;          // constant value
  // conditional:
  if_field?: string;
  if_equals?: string;
  then_mode?: "value" | "field";
  then_value?: string;
  then_field?: string;     // field name (from srr_row) when then_mode = field
  else_mode?: "value" | "field";
  else_value?: string;
  else_field?: string;
}

export interface TemplateColumn {
  header: string;
  source: ColumnSource | null;
  condition: ColumnCondition;
}

export interface ExportTemplate {
  id: string;
  name: string;
  target_menu: TargetMenu;
  is_active: boolean;
  columns: TemplateColumn[];
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

const cache = new Map<TargetMenu, { tpl: ExportTemplate | null; ts: number }>();
const TTL_MS = 30 * 1000;

export async function loadActiveTemplate(menu: TargetMenu): Promise<ExportTemplate | null> {
  const c = cache.get(menu);
  if (c && Date.now() - c.ts < TTL_MS) return c.tpl;
  const { data, error } = await supabase
    .from("export_templates")
    .select("*")
    .eq("target_menu", menu)
    .eq("is_active", true)
    .maybeSingle();
  if (error) {
    console.warn("loadActiveTemplate error:", error);
    return null;
  }
  const tpl = (data as any) || null;
  cache.set(menu, { tpl, ts: Date.now() });
  return tpl;
}

export function invalidateTemplateCache(menu?: TargetMenu) {
  if (menu) cache.delete(menu);
  else cache.clear();
}

export async function listTemplates(): Promise<ExportTemplate[]> {
  const { data, error } = await supabase
    .from("export_templates")
    .select("*")
    .order("target_menu")
    .order("name");
  if (error) throw error;
  return (data as any) || [];
}

const GROUP_HEADER_FIELDS = new Set([
  "partner_id", "Picking Type / Database ID", "Inter Transfer", "PO Group",
  "assigned_to", "description",
  "Company", "Partner", "RPM Type", "Currency", "Order Group",
  "Order Reference", "Customer", "Pricelist", "Source Document", "Warehouse",
]);

function isBlank(v: any): boolean {
  return v === undefined || v === null || v === "";
}

function resolveRowValue(row: Record<string, any>, field: string, carried?: Record<string, any>): any {
  const direct = row[field];
  if (!isBlank(direct)) return direct;
  if (GROUP_HEADER_FIELDS.has(field)) return carried?.[field] ?? "";
  return direct ?? "";
}

function resolveSourceValue(col: TemplateColumn, row: Record<string, any>, carried?: Record<string, any>): any {
  if (!col.source) return "";
  if (col.source.table === "srr_row") {
    return resolveRowValue(row, col.source.field, carried);
  }
  // lookups (data_master/vendor_master/po_cost) are pre-merged into row by caller if needed
  const k = `${col.source.table}.${col.source.field}`;
  return !isBlank(row[k]) ? row[k] : resolveRowValue(row, col.source.field, carried);
}

/**
 * Apply template to a group of rows (rows are one logical group, e.g. one vendor's PO).
 * Returns array of objects keyed by template header order.
 */
export function applyTemplateToGroup(
  template: ExportTemplate,
  rows: Record<string, any>[]
): Record<string, any>[] {
  const carriedByRow: Record<string, any>[] = [];
  const groupStartByRow: boolean[] = [];
  const carry: Record<string, any> = {};
  rows.forEach((row, idx) => {
    groupStartByRow[idx] = idx === 0 || [...GROUP_HEADER_FIELDS].some((f) => !isBlank(row[f]));
    for (const f of GROUP_HEADER_FIELDS) {
      if (!isBlank(row[f])) carry[f] = row[f];
    }
    carriedByRow[idx] = { ...carry };
  });

  return rows.map((row, idx) => {
    const out: Record<string, any> = {};
    const carried = carriedByRow[idx];
    for (const col of template.columns) {
      let v: any = "";
      const cond = col.condition || { type: "field" };

      // Normalize legacy types into (type, scope)
      let type: ConditionType = cond.type;
      let scope: RowScope = cond.scope ?? "all_row";
      if (type === "all_row") { type = "field"; scope = cond.scope ?? "all_row"; }
      else if (type === "first_row") { type = "field"; scope = cond.scope ?? "first_row"; }

      // Compute base value by type
      switch (type) {
        case "field":
          v = resolveSourceValue(col, row, carried);
          break;
        case "constant":
          v = cond.value ?? "";
          break;
        case "conditional": {
          const lhs = String(resolveRowValue(row, cond.if_field || "", carried));
          const matches = lhs === String(cond.if_equals ?? "");
          if (matches) {
            v = cond.then_mode === "field"
              ? resolveRowValue(row, cond.then_field || "", carried)
              : (cond.then_value ?? "");
          } else {
            v = cond.else_mode === "field"
              ? resolveRowValue(row, cond.else_field || "", carried)
              : (cond.else_value ?? "");
          }
          if (typeof v === "string") {
            v = v.replace(/\$\{([^}]+)\}/g, (_, f) => String(resolveRowValue(row, f, carried)));
          }
          break;
        }
      }

      // Apply scope (independent of type)
      if (scope === "first_row" && !groupStartByRow[idx]) v = "";

      out[col.header] = v;
    }
    return out;
  });
}

/**
 * High-level helper: if active template exists for menu, remap rows; else return rows unchanged.
 * Use in export sites that group rows per "document" (one call per group).
 */
export async function remapRowsByTemplate(
  menu: TargetMenu,
  rows: Record<string, any>[]
): Promise<Record<string, any>[]> {
  if (!rows.length) return rows;
  const tpl = await loadActiveTemplate(menu);
  if (!tpl || !tpl.columns?.length) return rows;
  return applyTemplateToGroup(tpl, rows);
}
