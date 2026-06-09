-- Cleanup + security hygiene สำหรับ Report OOS
--  1) ลบ snapshot ทดสอบที่อาจค้างไว้
--  2) REVOKE execute จาก PUBLIC/anon บนฟังก์ชันที่เขียนข้อมูล (เหลือเฉพาะ authenticated)
--     (Postgres ให้ PUBLIC execute เป็น default → ต้อง revoke เอง)

DELETE FROM public.oos_snapshots WHERE week_label = 'TEST';

REVOKE EXECUTE ON FUNCTION public.save_oos_snapshot(text,jsonb,text[],text[],text[],text[],text[],text[]) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.save_oos_snapshot(text,jsonb,text[],text[],text[],text[],text[],text[]) TO authenticated;
