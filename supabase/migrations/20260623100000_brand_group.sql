-- เพิ่มคอลัมน์ Group ให้ตาราง brand (List Brand) — ใช้จัดกลุ่มแยกเอกสาร Monthly usage / Order ตามกลุ่มแบรนด์
ALTER TABLE public.brand ADD COLUMN IF NOT EXISTS brand_group text;
