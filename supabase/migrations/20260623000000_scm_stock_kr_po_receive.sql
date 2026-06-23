-- ตารางเก็บข้อมูล Import ของ SCM Control → tab PO → sub-tab Stock Kr / PO Receive
-- เก็บถาวรใน Supabase (ทุก user เห็นชุดเดียวกัน) — Save = แทนที่ทั้งตาราง (replace all)

-- ===== Stock Kr =====
CREATE TABLE IF NOT EXISTS public.scm_stock_kr (
  row_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  id text,
  barcode text,
  description text,
  uom text,
  qty text,
  remark text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.scm_stock_kr ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "scm_stock_kr_authenticated_all" ON public.scm_stock_kr;
CREATE POLICY "scm_stock_kr_authenticated_all"
ON public.scm_stock_kr
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

-- ===== PO Receive =====
CREATE TABLE IF NOT EXISTS public.scm_po_receive (
  row_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  id text,
  created_date text,
  order_ref text,
  partner text,
  barcode text,
  product text,
  received_qty text,
  quantity text,
  status text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.scm_po_receive ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "scm_po_receive_authenticated_all" ON public.scm_po_receive;
CREATE POLICY "scm_po_receive_authenticated_all"
ON public.scm_po_receive
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);
