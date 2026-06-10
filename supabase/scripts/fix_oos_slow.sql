-- ============================================================
-- แก้ Report OOS ช้า หลัง re-import stock
-- สาเหตุ: ลบ/โหลด stock ใหม่ → dead tuples (bloat) + statistics เก่า
--         → query planner เลือกแผนผิด → ช้า 20 เท่า
--
-- วิธีรัน: เปิด Supabase Dashboard → SQL Editor → วางทั้งหมดนี้ → Run
--   (ต้องรันใน SQL Editor แบบไม่อยู่ใน transaction — VACUUM รันใน migration ไม่ได้)
--   ใช้เวลาประมาณ 10-60 วินาที
-- ============================================================

-- 1) VACUUM ANALYZE = เก็บกวาด dead tuples (bloat) + refresh statistics
--    (ตัวหลักที่แก้ปัญหา — โดยเฉพาะ stock ที่เพิ่งถูก re-import)
VACUUM (ANALYZE) public.stock;
VACUUM (ANALYZE) public.data_master;
VACUUM (ANALYZE) public.vendor_master;
VACUUM (ANALYZE) public.rank_sales;
VACUUM (ANALYZE) public.store_type;
VACUUM (ANALYZE) public.range_store_view;

-- 2) (ทางเลือก) ถ้ายังช้า ให้ VACUUM FULL เฉพาะ stock เพื่อบีบพื้นที่จริง
--    *** ระวัง: VACUUM FULL ล็อกตารางชั่วคราว (อ่าน/เขียนไม่ได้ระหว่างทำ) ***
--    *** ทำตอนไม่มีคนใช้งานเท่านั้น แล้วค่อยเอา comment ออก ***
-- VACUUM (FULL, ANALYZE) public.stock;
