// Helper: enrich SRR Skip List after Read & Cal
// SKUs imported by user but missing from RPC result are filtered by the
// SRR business rules. Current rules (Apr 2026):
//   - product_owner = 'Lanexang Green Property Sole Co.,Ltd'
//   - buying_status <> 'Inactive'
//   - vendor_code must exist in vendor_master
//   - vendor_master.vendor_origin contains 'lao' or 'thai' (case-insensitive)
//   - SKU distinct (DISTINCT ON sku_code in RPC)
// Removed (no longer skip): Discontinue, Packing>1, Consignment, no sales/stock.

import { supabase } from "@/integrations/supabase/client";
import type { SkippedItem } from "@/components/ImportSkipDialog";

const CHUNK = 300;
const LANEXANG_OWNER = "Lanexang Green Property Sole Co.,Ltd";

/** Build SkippedItem[] for SKUs that were imported but did NOT appear in the RPC result. */
export async function enrichSkippedSkusAfterRead(
  importedSkus: string[],
  rpcResultSkus: Set<string>,
): Promise<SkippedItem[]> {
  const missing = importedSkus.filter((s) => s && !rpcResultSkus.has(s));
  if (missing.length === 0) return [];

  // Pull data_master rows for missing SKUs to determine reason
  const map = new Map<
    string,
    { buying_status?: string; vendor_code?: string; product_owner?: string; product_name?: string }
  >();
  for (let i = 0; i < missing.length; i += CHUNK) {
    const slice = missing.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from("data_master")
      .select("sku_code, buying_status, vendor_code, product_owner, product_name_la, product_name_en")
      .in("sku_code", slice);
    if (error) continue;
    for (const r of (data || []) as any[]) {
      const cur = map.get(r.sku_code);
      // Prefer the Lanexang row to surface the correct status/vendor
      const isLanexang = (r.product_owner || "").trim() === LANEXANG_OWNER;
      const curIsLanexang = (cur?.product_owner || "").trim() === LANEXANG_OWNER;
      if (!cur || (isLanexang && !curIsLanexang)) {
        map.set(r.sku_code, {
          buying_status: r.buying_status,
          vendor_code: r.vendor_code,
          product_owner: r.product_owner,
          product_name: r.product_name_la || r.product_name_en || "",
        });
      }
    }
  }

  // Vendor existence lookup + vendor_origin (must be Laos or Thailand contains)
  const vendorCodesToCheck = new Set<string>();
  for (const m of map.values()) if (m.vendor_code) vendorCodesToCheck.add(m.vendor_code);
  const knownVendors = new Set<string>();
  const vendorOrigins = new Map<string, string>();
  if (vendorCodesToCheck.size > 0) {
    const arr = [...vendorCodesToCheck];
    for (let i = 0; i < arr.length; i += CHUNK) {
      const slice = arr.slice(i, i + CHUNK);
      const { data } = await supabase
        .from("vendor_master")
        .select("vendor_code, vendor_origin")
        .in("vendor_code", slice);
      for (const r of (data || []) as any[]) {
        if (r.vendor_code) {
          knownVendors.add(r.vendor_code);
          vendorOrigins.set(r.vendor_code, (r.vendor_origin || "").toString());
        }
      }
    }
  }
  const isAllowedOrigin = (o: string) => {
    const s = (o || "").toLowerCase();
    return s.includes("lao") || s.includes("thai");
  };

  const out: SkippedItem[] = [];
  for (const sku of missing) {
    const m = map.get(sku);
    if (!m) {
      out.push({
        kind: "sku",
        key: sku,
        reason: "ไม่พบใน Master",
        detail: "ไม่มี SKU นี้ใน data_master",
      });
      continue;
    }
    const owner = (m.product_owner || "").trim();
    const status = (m.buying_status || "").trim();
    const namePart = m.product_name ? ` · ${m.product_name}` : "";
    let reason = "ถูกกรองออก (ไม่ผ่านเกณฑ์ SRR)";
    let detail = `SKU ${sku}${namePart}`;
    if (owner !== LANEXANG_OWNER) {
      reason = "ไม่ใช่ของ Lanexang";
      detail = `${detail} · product_owner = ${owner || "-"}`;
    } else if (status === "Inactive") {
      reason = "Inactive";
      detail = `${detail} · buying_status = Inactive`;
    } else if (!m.vendor_code) {
      reason = "ไม่มี Vendor Code";
      detail = `${detail} · vendor_code ว่าง`;
    } else if (!knownVendors.has(m.vendor_code)) {
      reason = "Vendor ไม่อยู่ใน Vendor Master";
      detail = `${detail} · vendor_code = ${m.vendor_code}`;
    } else if (!isAllowedOrigin(vendorOrigins.get(m.vendor_code) || "")) {
      reason = "Vendor Origin ไม่ใช่ Laos/Thailand";
      detail = `${detail} · vendor_origin = ${vendorOrigins.get(m.vendor_code) || "-"}`;
    } else {
      detail = `${detail} · owner=${owner || "-"} · status=${status || "-"} · vendor=${m.vendor_code}`;
    }
    out.push({ kind: "sku", key: sku, reason, detail });
  }
  return out;
}

/** Build SkippedItem[] for vendor codes that were imported but produced 0 rows after Read & Cal. */
export function buildVendorEmptyResultSkips(
  importedVendorCodes: string[],
  vendorsWithRows: Set<string>,
): SkippedItem[] {
  const missing = importedVendorCodes.filter((v) => v && !vendorsWithRows.has(v));
  return missing.map((v) => ({
    kind: "vendor" as const,
    key: v,
    reason: "ไม่มี SKU ผ่านเกณฑ์ SRR",
    detail: `Vendor ${v} · ไม่มีรายการเข้าหลัง Read & Cal (อาจไม่ใช่ของ Lanexang, Inactive, หรือ vendor_origin ไม่ใช่ Laos/Thailand)`,
  }));
}
