-- เพิ่มคอลัมน์รูปภาพให้ DC(KR) Control → Data
ALTER TABLE public.dckr_item ADD COLUMN IF NOT EXISTS picture text;
ALTER TABLE public.dckr_item ADD COLUMN IF NOT EXISTS picture_brand text;
