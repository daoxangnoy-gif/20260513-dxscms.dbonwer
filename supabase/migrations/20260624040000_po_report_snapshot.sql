-- เก็บ snapshot รายงาน PO (Group by Remark / Action2 → Count distinct SKU)
-- 1 ครั้งที่กด Save = 1 batch (หลายแถว: แถวละ category) → แสดงเป็น 1 คอลัมน์ในรายงาน
CREATE TABLE IF NOT EXISTS public.po_report_snapshot (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL,
  saved_label text NOT NULL,        -- หัวคอลัมน์ (วันที่/เวลา)
  saved_at timestamptz NOT NULL DEFAULT now(),
  report_type text NOT NULL,        -- 'remark' | 'action2'
  category text NOT NULL,
  sku_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS po_report_snapshot_type_idx ON public.po_report_snapshot(report_type, saved_at);

ALTER TABLE public.po_report_snapshot ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "po_report_snapshot_authenticated_all" ON public.po_report_snapshot;
CREATE POLICY "po_report_snapshot_authenticated_all"
ON public.po_report_snapshot
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);
