-- Job Assign: ต่อเวลา (extend) + พิสูจน์งานสำเร็จ (completion proof)
-- เพิ่มคอลัมน์รองรับ: วันนัดส่งเดิม, ประวัติการต่อเวลา, หลักฐานงานสำเร็จ

ALTER TABLE public.job_assignments
  ADD COLUMN IF NOT EXISTS original_due_date date,
  ADD COLUMN IF NOT EXISTS extensions jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS completion_note text,
  ADD COLUMN IF NOT EXISTS completion_attachment_url text,
  ADD COLUMN IF NOT EXISTS completion_attachment_name text,
  ADD COLUMN IF NOT EXISTS completion_attachment_type text;

-- backfill: รายการเดิมให้ original_due_date = due_date ปัจจุบัน
UPDATE public.job_assignments
  SET original_due_date = due_date
  WHERE original_due_date IS NULL;
