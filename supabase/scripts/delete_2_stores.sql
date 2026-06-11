-- ============================================================
-- ลบ 2 สาขา: 132030003-Phonpapao, 132040004-Thamuang
--   ออกจากทั้ง snapshot ที่ save + ต้นทาง (range_store, store_type)
-- ⚠️ ลบถาวร + กระทบทุกฟีเจอร์ที่ใช้ range_store/store_type (SAR, MinMax ฯลฯ)
-- วิธีรัน: Supabase SQL Editor
-- ============================================================

-- ========== ส่วนที่ 1 — รันทีเดียวได้ (เลือกทั้งบล็อก → Run) ==========

-- 1) ต้นทาง: range_store (ลบด้วย code prefix กันพลาดเรื่องสะกดชื่อ)
DELETE FROM public.range_store
WHERE store_name LIKE '132030003%' OR store_name LIKE '132040004%';

-- 2) ต้นทาง: store_type (master สาขา)
DELETE FROM public.store_type
WHERE code IN ('132030003','132040004')
   OR store_name IN ('132030003-Phonpapao','132040004-Thamuang');

-- 3) sync range_store_view ให้ตรงกับ range_store ใหม่ (เอา 2 สาขาออกจาก range_data)
SELECT public.sync_range_store_view();

-- 4) snapshot ที่ save: ลบแถว 2 สาขา ออกทุก week
DELETE FROM public.oos_snapshot_rows
WHERE store_name IN ('132030003-Phonpapao','132040004-Thamuang');

-- 5) อัปเดต total_rows ของ snapshots ให้ตรงหลังลบ
UPDATE public.oos_snapshots s
SET total_rows = (SELECT count(*) FROM public.oos_snapshot_rows r WHERE r.snapshot_id = s.id);

-- (ตัวเลือก) ถ้าต้องการล้าง stock ของ 2 สาขาด้วย เอา comment ออก:
-- DELETE FROM public.stock WHERE company IN ('132030003-Phonpapao','132040004-Thamuang');


-- ========== ส่วนที่ 2 — รัน "แยกบรรทัด" (เลือกบรรทัดล่างนี้บรรทัดเดียว → Run) ==========
-- rebuild MV ให้ live Get/Report สะอาดทันที (~1-2 นาที)
-- *** REFRESH CONCURRENTLY รันรวมกับคำสั่งอื่นไม่ได้ → ต้องเลือกบรรทัดนี้ Run เดี่ยวๆ ***
SELECT public.refresh_oos_mv();
