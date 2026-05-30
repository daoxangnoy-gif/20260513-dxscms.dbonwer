import * as XLSX from "xlsx";
import { colLetter } from "./srrExportFormulas";

function buildHeaderMap(headers: string[]): Map<string, string> {
  const m = new Map<string, string>();
  headers.forEach((h, i) => m.set(String(h).trim().toLowerCase(), colLetter(i)));
  return m;
}
function get(map: Map<string, string>, ...names: string[]): string | null {
  for (const n of names) {
    const v = map.get(n.trim().toLowerCase());
    if (v) return v;
  }
  return null;
}
function setAt(headers: string[], row: string[], col: string | null, formula: string) {
  if (!col) return;
  const idx = XLSX.utils.decode_col(col);
  if (idx >= 0 && idx < headers.length) row[idx] = formula;
}

// SAR formula row (row 1 template referencing row 1 — buildSheetWithFormulaRow pattern)
// Formulas mirror src/lib/sarCalc.ts:
//   Suggest1 = IF(MAX(StoreStock,0)+OnOrder>Min, 0,
//                  MAX( IF(MAX(StoreStock,0)<=Min, Max-MAX(StoreStock,0), 0) - OnOrder, 0))
//   Suggest2 = IF(StockDC>0, MIN(StockDC, Suggest1), 0)
//   TT Order = IF(Suggest2>0, MIN(StockDC, CEILING(Suggest2/UnitPick,1)*UnitPick), 0)
//   Final/Unit = IF(ISNUMBER(SuggestEdit)*(SuggestEdit>0), CEILING(SuggestEdit/UnitPick,1)*UnitPick, TTOrder)
//   Final/UOM  = Final/Unit / UnitPick
//   DOH MIN/MAX/Stock = IFERROR(x/AvgSale, 0)
export function buildSARFormulaRow(headers: string[]): string[] {
  const m = buildHeaderMap(headers);
  const row = new Array(headers.length).fill("");
  const r = 1;

  const unitPick    = get(m, "Unit Pick", "unit_pick");
  const avgSale     = get(m, "Avg Sale", "avg_sale");
  const minV        = get(m, "Min", "min_val");
  const maxV        = get(m, "Max", "max_val");
  const stockDC     = get(m, "Stock DC", "stock_dc");
  const stockStore  = get(m, "Store Stock", "stock_store");
  const sug1        = get(m, "SAR Suggest1", "sar_suggest1");
  const sug2        = get(m, "SAR Suggest2", "sar_suggest2");
  const onOrder     = get(m, "On Order", "on_order");
  const ttOrder     = get(m, "TT Order", "tt_order");
  const sugEdit     = get(m, "Suggest Order Edit", "suggest_order_edit");
  const finUnit     = get(m, "Final Order/Unit", "final_order_unit");
  const finUom      = get(m, "Final Order/UOM", "final_order_uom");
  const dohMin      = get(m, "DOH MIN", "doh_min");
  const dohMax      = get(m, "DOH MAX", "doh_max");
  const dohStock    = get(m, "DOH Stock", "doh_stock");
  const dohTobe     = get(m, "DOH Tobe", "doh_tobe");

  if (stockStore && onOrder && minV && maxV) {
    const ss = `MAX(${stockStore}${r},0)`;
    setAt(headers, row, sug1,
      `=IF(${ss}+${onOrder}${r}>${minV}${r},0,MAX(IF(${ss}<=${minV}${r},${maxV}${r}-${ss},0)-${onOrder}${r},0))`);
  }
  if (stockDC && sug1) setAt(headers, row, sug2,
    `=IF(${stockDC}${r}>0,MIN(${stockDC}${r},${sug1}${r}),0)`);

  if (sug2 && stockDC && unitPick) setAt(headers, row, ttOrder,
    `=IFERROR(IF(${sug2}${r}>0,MIN(${stockDC}${r},CEILING(${sug2}${r}/${unitPick}${r},1)*${unitPick}${r}),0),0)`);

  if (sugEdit && unitPick && ttOrder) setAt(headers, row, finUnit,
    `=IFERROR(IF(AND(ISNUMBER(${sugEdit}${r}),${sugEdit}${r}>0),CEILING((${sugEdit}${r}*${unitPick}${r})/${unitPick}${r},1)*${unitPick}${r},${ttOrder}${r}),${ttOrder}${r})`);

  if (finUnit && unitPick) setAt(headers, row, finUom,
    `=IFERROR(${finUnit}${r}/${unitPick}${r},0)`);

  if (minV && avgSale) setAt(headers, row, dohMin,
    `=IFERROR(${minV}${r}/${avgSale}${r},0)`);
  if (maxV && avgSale) setAt(headers, row, dohMax,
    `=IFERROR(${maxV}${r}/${avgSale}${r},0)`);
  if (stockStore && avgSale) setAt(headers, row, dohStock,
    `=IFERROR(${stockStore}${r}/${avgSale}${r},0)`);
  if (finUnit && onOrder && stockStore && avgSale) setAt(headers, row, dohTobe,
    `=IFERROR((${finUnit}${r}+${onOrder}${r}+MAX(${stockStore}${r},0))/${avgSale}${r},0)`);

  return row;
}
