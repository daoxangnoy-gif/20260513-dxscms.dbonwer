-- ============================================================
-- แก้ Report OOS ช้า หลัง re-import stock
-- สาเหตุ: ลบ/โหลด stock ใหม่ (387k -> 118k) -> statistics เก่า + dead tuples (bloat)
--         -> query planner เลือกแผนผิด -> ช้า 20 เท่า (4.6s -> >125s)
-- ============================================================


-- ============================================================
-- ✅ ส่วนที่ 1 — รันทีเดียวได้เลย (เลือกทั้งบล็อกนี้ -> Run)
--    ANALYZE = refresh statistics ให้ planner เลือกแผนถูก = ตัวแก้หลัก
--    (ANALYZE รันรวมกันหลายคำสั่งได้ ไม่ติด transaction)
-- ============================================================
ANALYZE public.stock;
ANALYZE public.data_master;
ANALYZE public.vendor_master;
ANALYZE public.rank_sales;
ANALYZE public.store_type;
ANALYZE public.range_store_view;

-- >>> รันแค่ส่วนที่ 1 เสร็จแล้ว ลองกลับไปทดสอบหน้า Report OOS ก่อน <<<
-- >>> ถ้าเร็วขึ้นแล้ว = จบ ไม่ต้องทำส่วนที่ 2 <<<


-- ============================================================
-- ⚠️ ส่วนที่ 2 — ทำเฉพาะถ้า "ส่วนที่ 1 แล้วยังช้า"
--    VACUUM = เก็บกวาด dead tuples (bloat) คืนพื้นที่
--    *** VACUUM รันรวมกับคำสั่งอื่นไม่ได้ -> ต้องเลือกทีละบรรทัด แล้ว Run ทีละอัน ***
-- ============================================================
-- VACUUM (ANALYZE) public.stock;
-- VACUUM (ANALYZE) public.data_master;
-- VACUUM (ANALYZE) public.range_store_view;

-- ถ้ายังช้าอีก (bloat หนักมาก) ค่อยใช้ FULL — แต่ล็อกตาราง ห้ามมีคนใช้งานระหว่างทำ:
-- VACUUM (FULL, ANALYZE) public.stock;
