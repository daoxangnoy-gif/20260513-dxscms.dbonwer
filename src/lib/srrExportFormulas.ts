import * as XLSX from "xlsx";

// Convert 0-based column index to Excel letter (A, B, ..., Z, AA, AB, ...)
export function colLetter(idx: number): string {
  let s = "";
  let n = idx;
  while (n >= 0) {
    s = String.fromCharCode((n % 26) + 65) + s;
    n = Math.floor(n / 26) - 1;
  }
  return s;
}

// Build a Map<headerLabel, columnLetter> from header array (case-insensitive)
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

function setAt(headers: string[], row: string[], columnLetter: string | null, formula: string) {
  if (!columnLetter) return;
  const idx = XLSX.utils.decode_col(columnLetter);
  if (idx >= 0 && idx < headers.length) row[idx] = formula;
}

// ============ SRR DC ============
// User-provided formulas (referencing row 1) — kept as row 1 template for drag/copy
// DC Min       = IFERROR(AM*AV, 0)
// Gap Store    = IF(IF(AH<=0,0,AH)<=Z, Z-IF(AH<=0,0,AH), 0)
// Gap DC       = IF(IF(AB<=0,0,AB)<=AW, AW-IF(AB<=0,0,AB), 0)
// Suggest Qty  = IFERROR(IF(((AZ+AY)-AX)<=0,0,((AZ+AY)-AX)), 0)
// Final Suggest= IFERROR(ROUNDUP(BA/AN,0)*AN, 0)
// Final UOM    = IFERROR(BB/AN, 0)
// DOH ASIS     = IFERROR(AG/AM, 0)
// DOH TOBE     = IFERROR(((AG+BB+AX)-(AM*AT))/AM, 0)
//
// Letters → header (semantic mapping):
//   AM = Avg/Day (avg_sales_tt)
//   AV = TT Safety
//   AH = Store Stock (tt_stock_store)
//   Z  = Min Store (tt_min)
//   AB = On Hand (stock_dc)
//   AW = DC Min
//   AY = Gap Store
//   AZ = Gap DC
//   AX = On Order
//   BA = Suggest Qty
//   BB = Final Suggest
//   AN = MOQ
//   AG = TT Stock
//   AT = Leadtime
export function buildSRRDCFormulaRow(headers: string[]): string[] {
  const m = buildHeaderMap(headers);
  const row = new Array(headers.length).fill("");
  const r = 1;

  const avgDay     = get(m, "Avg/Day", "Avg TT", "avg_sales_tt", "avg_day");
  const ttSafety   = get(m, "TT Safety", "tt_safety");
  const ttStock    = get(m, "TT Stock", "tt_stock");
  const storeStock = get(m, "TT Stock Store", "Store Stock", "tt_stock_store", "store_stock");
  const minStore   = get(m, "TT MIN", "Min Store", "tt_min", "min_store");
  const onHand     = get(m, "Stock DC", "On Hand", "stock_dc", "on_hand");
  const dcMin      = get(m, "DC Min", "dc_min");
  const gapStore   = get(m, "Gap Store", "gap_store");
  const gapDC      = get(m, "Gap DC", "gap_dc");
  const onOrder    = get(m, "On Order", "on_order");
  const suggestQty = get(m, "Suggest Qty", "suggest_qty");
  const finalSugg  = get(m, "Final Suggest", "final_suggest_qty", "final_suggest");
  const finalUom   = get(m, "Final UOM", "final_suggest_uom", "final_uom");
  const moq        = get(m, "MOQ", "Moq", "moq");
  const leadtime   = get(m, "Leadtime", "leadtime");
  const dohAsis    = get(m, "DOH ASIS", "DOH AsIs", "doh_asis");
  const dohTobe    = get(m, "DOH TOBE", "DOH ToBe", "doh_tobe");

  // DC Min = IFERROR(AvgDay*TTSafety, 0)  — original sheet AM*AV
  if (avgDay && ttSafety) setAt(headers, row, dcMin,
    `=IFERROR(${avgDay}${r}*${ttSafety}${r},0)`);

  // Gap Store = IF(IF(StoreStock<=0,0,StoreStock)<=MinStore, MinStore-IF(StoreStock<=0,0,StoreStock), 0)
  if (storeStock && minStore) setAt(headers, row, gapStore,
    `=IF(IF(${storeStock}${r}<=0,0,${storeStock}${r})<=${minStore}${r},${minStore}${r}-IF(${storeStock}${r}<=0,0,${storeStock}${r}),0)`);

  // Gap DC = IF(IF(OnHand<=0,0,OnHand)<=DCMin, DCMin-IF(OnHand<=0,0,OnHand), 0)
  if (onHand && dcMin) setAt(headers, row, gapDC,
    `=IF(IF(${onHand}${r}<=0,0,${onHand}${r})<=${dcMin}${r},${dcMin}${r}-IF(${onHand}${r}<=0,0,${onHand}${r}),0)`);

  // Suggest Qty = IFERROR(IF(((GapDC+GapStore)-OnOrder)<=0,0,((GapDC+GapStore)-OnOrder)), 0)
  if (gapDC && gapStore && onOrder) setAt(headers, row, suggestQty,
    `=IFERROR(IF(((${gapDC}${r}+${gapStore}${r})-${onOrder}${r})<=0,0,((${gapDC}${r}+${gapStore}${r})-${onOrder}${r})),0)`);

  // Final Suggest = IFERROR(ROUNDUP(SuggestQty/MOQ,0)*MOQ, 0)
  if (suggestQty && moq) setAt(headers, row, finalSugg,
    `=IFERROR(ROUNDUP(${suggestQty}${r}/${moq}${r},0)*${moq}${r},0)`);

  // Final UOM = IFERROR(FinalSuggest/MOQ, 0)
  if (finalSugg && moq) setAt(headers, row, finalUom,
    `=IFERROR(${finalSugg}${r}/${moq}${r},0)`);

  // DOH ASIS = IFERROR(TTStock/AvgDay, 0) — original sheet AG/AM
  if (ttStock && avgDay) setAt(headers, row, dohAsis,
    `=IFERROR(${ttStock}${r}/${avgDay}${r},0)`);

  // DOH TOBE = IFERROR(((TTStock+FinalSuggest+OnOrder)-(AvgDay*Leadtime))/AvgDay, 0) — original sheet AG+BB+AX-(AM*AT)
  if (ttStock && finalSugg && onOrder && avgDay && leadtime) setAt(headers, row, dohTobe,
    `=IFERROR(((${ttStock}${r}+${finalSugg}${r}+${onOrder}${r})-(${avgDay}${r}*${leadtime}${r}))/${avgDay}${r},0)`);

  return row;
}

// ============ SRR DIRECT ============
// User-provided formulas (referencing row 1) — kept as row 1 template for drag/copy:
// SRR Suggest (pcs) = IF(IF(X<=0,0,X)<=W, (V*Z)+W-IF(X<=0,0,X), 0)
// FinalOrder Qty    = IFERROR(MAX(AB-AC,0), 0)
// FinalOrderR_up    = IFERROR(CEILING(MAX(AD,AK*AE)/AE,1)*AE, 0)
// FinalOrder UOM    = IFERROR(AH/AE, 0)
// AsIs DOH          = IFERROR(X/V, 0)
// ToBe DOH          = IFERROR(((X+AH+AC)-(V*AA))/V, 0)
//
// Letters → header (semantic):
//   V = Avg Unit Sale/Day, W = Min Store, X = Store Stock, Z = Order Cycle, AA = LeadTimeDelivery
//   AB = SRR Suggest (pcs), AC = On Order (pcs), AD = FinalOrder Qty, AE = MOQ
//   AF = FinalOrderR_up, AH = FinalOrder UOM (display) — but per user formula AH is FinalOrderR_up source
//   AK = Order UOM EDIT
// NOTE: User's formula writes "FinalOrder UOM = AH/AE" where AH is FinalOrderR_up.
//       Mapping AH semantically = FinalOrderR_up.
export function buildSRRDirectFormulaRow(headers: string[]): string[] {
  const m = buildHeaderMap(headers);
  const row = new Array(headers.length).fill("");
  const r = 1;

  const avgDay      = get(m, "Avg Unit Sale/Day", "avg_sales_store", "Avg/Day");
  const minStore    = get(m, "Min Store", "min_store");
  const storeStock  = get(m, "Store Stock", "stock_store");
  const orderCycle  = get(m, "Order Cycle", "order_cycle");
  const leadtime    = get(m, "LeadTimeDelivery", "leadtime");
  const srrSuggest  = get(m, "SRR Suggest (pcs)", "srr_suggest");
  const onOrder     = get(m, "On Order (pcs)", "on_order_store");
  const finalQty    = get(m, "FinalOrder Qty", "final_order_qty");
  const moq         = get(m, "MOQ", "moq");
  const finalRup    = get(m, "FinalOrderR_up", "final_order_uom");
  const finalUom    = get(m, "FinalOrder UOM", "final_order_uom_div");
  const orderUomEd  = get(m, "Order UOM EDIT", "order_uom_edit");
  const asisDoh     = get(m, "AsIs DOH", "doh_asis");
  const tobeDoh     = get(m, "ToBe DOH", "doh_tobe");

  // SRR Suggest = IF(IF(StoreStock<=0,0,StoreStock)<=MinStore, (Avg*OC)+MinStore-IF(StoreStock<=0,0,StoreStock), 0)
  if (storeStock && minStore && avgDay && orderCycle) setAt(headers, row, srrSuggest,
    `=IF(IF(${storeStock}${r}<=0,0,${storeStock}${r})<=${minStore}${r},(${avgDay}${r}*${orderCycle}${r})+${minStore}${r}-IF(${storeStock}${r}<=0,0,${storeStock}${r}),0)`);

  // FinalOrder Qty = IFERROR(MAX(SRRSuggest - OnOrder, 0), 0)
  if (srrSuggest && onOrder) setAt(headers, row, finalQty,
    `=IFERROR(MAX(${srrSuggest}${r}-${onOrder}${r},0),0)`);

  // FinalOrderR_up = IFERROR(CEILING(MAX(FinalQty, OrderUomEdit*MOQ)/MOQ, 1) * MOQ, 0)
  if (finalQty && moq && orderUomEd) setAt(headers, row, finalRup,
    `=IFERROR(CEILING(MAX(${finalQty}${r},${orderUomEd}${r}*${moq}${r})/${moq}${r},1)*${moq}${r},0)`);

  // FinalOrder UOM = IFERROR(FinalOrderR_up / MOQ, 0)
  if (finalRup && moq) setAt(headers, row, finalUom,
    `=IFERROR(${finalRup}${r}/${moq}${r},0)`);

  // AsIs DOH = IFERROR(StoreStock / AvgDay, 0)
  if (storeStock && avgDay) setAt(headers, row, asisDoh,
    `=IFERROR(${storeStock}${r}/${avgDay}${r},0)`);

  // ToBe DOH = IFERROR(((StoreStock + FinalRup + OnOrder) - (Avg * Leadtime)) / Avg, 0)
  // NOTE: original formula uses AA (LeadTimeDelivery), not Order Cycle
  if (storeStock && finalRup && onOrder && avgDay && leadtime) setAt(headers, row, tobeDoh,
    `=IFERROR(((${storeStock}${r}+${finalRup}${r}+${onOrder}${r})-(${avgDay}${r}*${leadtime}${r}))/${avgDay}${r},0)`);

  return row;
}

// Build worksheet with: Row1=formulas, Row2=headers, Row3+=data
export function buildSheetWithFormulaRow(
  headers: string[],
  dataRows: Record<string, any>[],
  formulaRow: string[],
): XLSX.WorkSheet {
  const aoa: any[][] = [];
  aoa.push(formulaRow);
  aoa.push(headers);
  for (const r of dataRows) {
    aoa.push(headers.map(h => r[h] ?? ""));
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  // Mark formula cells so xlsx writes them as formulas
  for (let c = 0; c < formulaRow.length; c++) {
    const v = formulaRow[c];
    if (typeof v === "string" && v.startsWith("=")) {
      const addr = XLSX.utils.encode_cell({ r: 0, c });
      ws[addr] = { t: "n", f: v.substring(1), v: 0 };
    }
  }
  return ws;
}
