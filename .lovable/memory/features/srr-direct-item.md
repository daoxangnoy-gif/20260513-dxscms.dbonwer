---
name: SRR Direct Item Architecture
description: SRR DIRECT ITEM (D2S) per-store calculation, separate from DC ITEM
type: feature
---
SRR DIRECT ITEM คำนวณแบบ Per-Store (Direct to Store):

## คอลัมน์หลัก
- Store Name, Vendor, Trade Term, SPC, Order Day, Delivery Day
- SKU Code, Product Name LA/EN, Sale Rank, UnitName (1x MOQ)
- Avg Unit Sale/Day (per store), Min Store, Store Stock, Stock DC
- Order Cycle, LeadTimeDelivery
- SRR Suggest = if(Stock<=0,0, if(Stock<=Min, Avg*OC + Min - Stock, 0))
- On Order (per store), FinalOrder = ceil((suggest-onorder)/MOQ)*MOQ
- MOQ, FinalOrder UOM, Order UOM EDIT, AsIs DOH, ToBe DOH

## DB: get_srr_d2s_data RPC
- Returns per-store rows (sku_code x store_name)
- Joins all 8 tables like DC but per-store instead of aggregated

## Sub-menus
- dc_item, direct_item, list_import_po_dc, list_import_po_d2s
- D2S POs saved to localStorage key "srr_saved_pos_d2s"
