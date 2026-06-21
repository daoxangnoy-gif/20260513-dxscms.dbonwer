-- รายการทดแทน (replacement) ต่อ 1 item ของ Monthly usage
-- คีย์ Barcode ทดแทน → resolve ID/Barcode Unit/Product name EN จาก data_master; Picture อัปเอง
ALTER TABLE public.monthly_usage_item
  ADD COLUMN IF NOT EXISTS repl_barcode text,       -- บาร์โค้ดทดแทน (คีย์เอง / import)
  ADD COLUMN IF NOT EXISTS repl_sku_code text,      -- ID (SKU) ของรายการทดแทน (resolve)
  ADD COLUMN IF NOT EXISTS repl_barcode_unit text,  -- main_barcode ของรายการทดแทน (resolve)
  ADD COLUMN IF NOT EXISTS repl_picture text;       -- รูปรายการทดแทน (อัปเอง)
