// Module-level cache so SAR page state persists across navigation
import type { SARRow } from "./sarCalc";
import type { SkippedItem } from "@/components/ImportSkipDialog";

type Mode = "filter" | "import";

export interface ImportedQty {
  key: string;       // sku or barcode as entered
  store_name: string;
  qty_uom: number | null;
  qty_unit: number | null;
}

export const sarState: {
  rows: SARRow[];
  calculated: boolean;
  mode: Mode;
  storeFilter: string[];
  typeStoreFilter: string[];
  itemTypeFilter: string[];
  buyingFilter: string[];
  divisionFilter: string[];
  departmentFilter: string[];
  subDeptFilter: string[];
  classFilter: string[];
  skuFilter: string[];
  barcodeFilter: string[];
  importedKeys: string[];
  importedFileLabel: string;
  importedRows: ImportedQty[];
  importSkipped: SkippedItem[];
} = {
  rows: [],
  calculated: false,
  mode: "filter",
  storeFilter: [],
  typeStoreFilter: [],
  itemTypeFilter: [],
  buyingFilter: [],
  divisionFilter: [],
  departmentFilter: [],
  subDeptFilter: [],
  classFilter: [],
  skuFilter: [],
  barcodeFilter: [],
  importedKeys: [],
  importedFileLabel: "",
  importedRows: [],
  importSkipped: [],
};
