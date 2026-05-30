// SAR (เบิกก่อนได้ก่อน) — calculations
export interface SARRow {
  // From Doc Min/Max
  sku_code: string;
  main_barcode: string | null;
  product_name_la: string | null;
  product_name_en: string | null;
  unit_of_measure: string | null;
  store_name: string;
  type_store: string;
  division: string;
  department: string;
  sub_department: string;
  item_type: string;
  buying_status: string;
  unit_pick: number;          // = unit_pick_edit ?? 1
  pack_qty: number | null;
  box_qty: number | null;
  cost: number | null;        // standard_price (packing_size_qty=1)
  price2km: number | null;    // list_price (packing_size_qty=1)
  price_jm: number | null;    // jmart_price (packing_size_qty=1)
  pack_size: string;          // "Unit" if unit_pick=1, else "1x<unit_pick>"
  avg_sale: number;
  rank_sale: string;
  rank_factor: number;
  min_val: number;            // min_final from doc
  max_val: number;            // max_final from doc

  // Computed (after Calculate)
  stock_dc: number;
  stock_store: number;
  on_order: number;
  sar_suggest1: number;
  sar_suggest2: number;
  tt_order: number;
  suggest_order_edit: number | null;
  final_order_unit: number;
  final_order_uom: number;
  doh_min: number;
  doh_max: number;
  doh_stock: number;
  doh_tobe: number;
  calculated: boolean;
}

function pos(n: number): number {
  return n < 0 ? 0 : n;
}

/**
 * SAR Suggest1 (per spec):
 *   ss = max(stock_store, 0)
 *   inner = (ss + on_order > min) ? 0
 *         : ((ss <= min ? max - ss : 0) - on_order)
 *   suggest1 = max(inner, 0)
 */
export function calcSuggest1(stockStore: number, onOrder: number, min: number, max: number): number {
  const ss = pos(stockStore);
  if (ss + onOrder > min) return 0;
  const gap = ss <= min ? max - ss : 0;
  const inner = gap - onOrder;
  return inner < 0 ? 0 : inner;
}

/** SAR Suggest2 = IF(StockDC > 0, MIN(StockDC, Suggest1), 0) */
export function calcSuggest2(stockDC: number, suggest1: number): number {
  if (stockDC <= 0) return 0;
  return Math.min(stockDC, suggest1);
}

/** TT Order = IF(Suggest2 > 0, MIN(StockDC, CEIL(Suggest2/UnitPick)*UnitPick), 0) */
export function calcTTOrder(suggest2: number, stockDC: number, unitPick: number): number {
  if (suggest2 <= 0) return 0;
  const up = unitPick > 0 ? unitPick : 1;
  const roundup = Math.ceil(suggest2 / up) * up;
  return Math.min(stockDC, roundup);
}

/** Final Order/Unit = if edit>0 → ceil((edit*UnitPick)/UnitPick)*UnitPick (edit treated as UOM count), else TT Order */
export function calcFinalOrderUnit(edit: number | null, ttOrder: number, unitPick: number): number {
  const up = unitPick > 0 ? unitPick : 1;
  if (edit != null && edit > 0) {
    return Math.ceil((edit * up) / up) * up;
  }
  return ttOrder;
}

/** Final Order/UOM = Final/Unit ÷ UnitPick */
export function calcFinalOrderUOM(finalUnit: number, unitPick: number): number {
  const up = unitPick > 0 ? unitPick : 1;
  return finalUnit / up;
}

export function calcDOH(qty: number, avgSale: number): number {
  if (!avgSale || avgSale <= 0) return 0;
  return qty / avgSale;
}

/** Apply all SAR formulas to a row in-place (returns new row) */
export function computeRow(r: SARRow): SARRow {
  const s1 = calcSuggest1(r.stock_store, r.on_order, r.min_val, r.max_val);
  const s2 = calcSuggest2(r.stock_dc, s1);
  const tt = calcTTOrder(s2, r.stock_dc, r.unit_pick);
  const fu = calcFinalOrderUnit(r.suggest_order_edit, tt, r.unit_pick);
  const fuom = calcFinalOrderUOM(fu, r.unit_pick);
  return {
    ...r,
    sar_suggest1: s1,
    sar_suggest2: s2,
    tt_order: tt,
    final_order_unit: fu,
    final_order_uom: fuom,
    doh_min: calcDOH(r.min_val, r.avg_sale),
    doh_max: calcDOH(r.max_val, r.avg_sale),
    doh_stock: calcDOH(r.stock_store, r.avg_sale),
    doh_tobe: calcDOH(fu + r.on_order + pos(r.stock_store), r.avg_sale),
    calculated: true,
  };
}
