-- แก้อาการ Report OOS ช้าหลัง re-import stock (stats เก่า → query plan เพี้ยน)
-- ANALYZE refresh planner statistics ของตารางที่ _oos_detail ใช้
ANALYZE public.stock;
ANALYZE public.data_master;
ANALYZE public.vendor_master;
ANALYZE public.rank_sales;
ANALYZE public.store_type;
ANALYZE public.range_store_view;
