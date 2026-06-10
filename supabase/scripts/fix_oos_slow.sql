-- ============================================================
-- แก้ Report OOS ช้า หลัง re-import stock
-- อัปเดต: ANALYZE แล้วยังช้า -> สงสัย bloat (dead tuples) หรือ range_store_view โตจริง
-- ============================================================


-- ============================================================
-- 🔎 STEP 1 — DIAGNOSTIC (อ่านอย่างเดียว ปลอดภัย) — รันบล็อกนี้ทีเดียว แล้วส่งผลมาให้ผม
--    ดู: live = แถวจริง, dead = ขยะรอเก็บกวาด, size = ขนาดตาราง, last_vacuum/analyze
-- ============================================================
SELECT
  relname                                        AS table_name,
  n_live_tup                                     AS live_rows,
  n_dead_tup                                     AS dead_rows,
  CASE WHEN n_live_tup > 0
       THEN round(100.0 * n_dead_tup / n_live_tup, 1)
       ELSE 0 END                                AS dead_pct,
  pg_size_pretty(pg_total_relation_size(relid))  AS total_size,
  last_vacuum, last_autovacuum, last_analyze, last_autoanalyze
FROM pg_stat_user_tables
WHERE relname IN ('stock','data_master','range_store_view','vendor_master','rank_sales','sales_by_week')
ORDER BY n_dead_tup DESC;


-- ============================================================
-- 🛠 STEP 2 — รอผม diagnose ก่อน แล้วผมจะบอกว่าให้รันบรรทัดไหน
--    (ตัวเลือกที่น่าจะใช้ — VACUUM FULL บีบ bloat ออก ทำให้ scan เร็วขึ้น)
--    *** VACUUM ต้องเลือกทีละบรรทัด แล้ว Run ทีละอัน · FULL จะล็อกตารางชั่วคราว ***
-- ============================================================
-- VACUUM (FULL, ANALYZE) public.stock;
-- VACUUM (FULL, ANALYZE) public.range_store_view;
