-- SCM Control → tab SO
-- เมื่อ Save Order (หน้า Brand control → Order) ระบบแยกสร้าง SO Doc ตาม order_group
-- เฉพาะรายการที่มีจำนวนสั่ง (order_qty > 0) และ resolve เจอข้อมูล (มี barcode/product)
-- 1 order_group = 1 SO Doc (regenerate ใหม่ทุกครั้งที่ Save Order เดิม)

-- เก็บ order_group ราย item ของ Order (ใช้ตอน reload + แยก SO)
ALTER TABLE public.order_item
  ADD COLUMN IF NOT EXISTS order_group text;

CREATE TABLE IF NOT EXISTS public.so_doc (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_no integer NOT NULL UNIQUE,   -- รันเลขอัตโนมัติ
  doc_label text,                   -- "{stamp} - {brand} - {order_group} (SO)"
  brand_id uuid,
  brand_name text,
  branch text,
  order_doc_id uuid,                -- order_doc ต้นทาง (ลบ/regen ตามนี้)
  order_group text,                 -- กลุ่มของ SO นี้ ("" = ไม่ระบุกลุ่ม)
  customer text,                    -- ค่าเริ่มต้น "40237 KR F&B Co.,LTD"
  item_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.so_item (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id uuid NOT NULL REFERENCES public.so_doc(id) ON DELETE CASCADE,
  sort_order integer NOT NULL DEFAULT 0,
  sku_code text,          -- ID = sku_code จาก data_master
  barcode text,
  barcode_unit text,      -- main_barcode จาก data_master
  product_name text,
  uom text,
  order_qty numeric,
  order_group text,
  picture text,
  remark text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.so_doc ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.so_item ENABLE ROW LEVEL SECURITY;

CREATE POLICY so_doc_select ON public.so_doc FOR SELECT TO authenticated USING (true);
CREATE POLICY so_doc_insert ON public.so_doc FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY so_doc_update ON public.so_doc FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY so_doc_delete ON public.so_doc FOR DELETE TO authenticated USING (true);

CREATE POLICY so_item_select ON public.so_item FOR SELECT TO authenticated USING (true);
CREATE POLICY so_item_insert ON public.so_item FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY so_item_update ON public.so_item FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY so_item_delete ON public.so_item FOR DELETE TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_so_item_doc ON public.so_item(doc_id);
CREATE INDEX IF NOT EXISTS idx_so_doc_no ON public.so_doc(doc_no);
CREATE INDEX IF NOT EXISTS idx_so_doc_order ON public.so_doc(order_doc_id);
