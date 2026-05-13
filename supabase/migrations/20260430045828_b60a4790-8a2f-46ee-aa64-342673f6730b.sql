
-- 1) Create po_cost_log table to track all changes to po_cost
CREATE TABLE IF NOT EXISTS public.po_cost_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- snapshot of po_cost row (all columns)
  po_cost_id uuid,
  item_id text,
  goodcode text,
  product_name text,
  vendor text,
  moq numeric,
  po_cost numeric,
  po_cost_unit numeric,
  -- activity tracking
  activity text NOT NULL,           -- 'INSERT' | 'UPDATE' | 'DELETE' | 'KEYEDIT'
  changes jsonb,                    -- { moq: {old, new}, po_cost: {old, new}, ... }
  -- audit
  user_id uuid,
  user_email text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_po_cost_log_created_at ON public.po_cost_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_po_cost_log_item_id ON public.po_cost_log (item_id);
CREATE INDEX IF NOT EXISTS idx_po_cost_log_vendor ON public.po_cost_log (vendor);
CREATE INDEX IF NOT EXISTS idx_po_cost_log_activity ON public.po_cost_log (activity);

ALTER TABLE public.po_cost_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_read_po_cost_log" ON public.po_cost_log
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "auth_insert_po_cost_log" ON public.po_cost_log
  FOR INSERT TO authenticated WITH CHECK (true);

-- Admin only delete (housekeeping)
CREATE POLICY "admin_delete_po_cost_log" ON public.po_cost_log
  FOR DELETE TO authenticated USING (has_role(auth.uid(), 'Admin'));

-- 2) Trigger function to log po_cost changes automatically
CREATE OR REPLACE FUNCTION public.log_po_cost_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_email text;
  v_changes jsonb := '{}'::jsonb;
  v_activity text;
  v_key_changed boolean := false;
BEGIN
  SELECT email INTO v_email FROM auth.users WHERE id = v_uid;

  IF (TG_OP = 'INSERT') THEN
    v_activity := 'INSERT';
    v_changes := jsonb_build_object(
      'moq', jsonb_build_object('old', NULL, 'new', NEW.moq),
      'po_cost', jsonb_build_object('old', NULL, 'new', NEW.po_cost)
    );
    INSERT INTO public.po_cost_log (po_cost_id, item_id, goodcode, product_name, vendor, moq, po_cost, po_cost_unit, activity, changes, user_id, user_email)
    VALUES (NEW.id, NEW.item_id, NEW.goodcode, NEW.product_name, NEW.vendor, NEW.moq, NEW.po_cost, NEW.po_cost_unit, v_activity, v_changes, v_uid, v_email);
    RETURN NEW;

  ELSIF (TG_OP = 'UPDATE') THEN
    -- detect key change (item_id or vendor changed)
    IF (COALESCE(NEW.item_id,'') <> COALESCE(OLD.item_id,'')) OR (COALESCE(NEW.vendor,'') <> COALESCE(OLD.vendor,'')) THEN
      v_key_changed := true;
    END IF;

    IF NEW.moq IS DISTINCT FROM OLD.moq THEN
      v_changes := v_changes || jsonb_build_object('moq', jsonb_build_object('old', OLD.moq, 'new', NEW.moq));
    END IF;
    IF NEW.po_cost IS DISTINCT FROM OLD.po_cost THEN
      v_changes := v_changes || jsonb_build_object('po_cost', jsonb_build_object('old', OLD.po_cost, 'new', NEW.po_cost));
    END IF;
    IF v_key_changed THEN
      v_changes := v_changes || jsonb_build_object(
        'item_id', jsonb_build_object('old', OLD.item_id, 'new', NEW.item_id),
        'vendor', jsonb_build_object('old', OLD.vendor, 'new', NEW.vendor)
      );
    END IF;

    -- skip if nothing meaningful changed
    IF v_changes = '{}'::jsonb THEN
      RETURN NEW;
    END IF;

    v_activity := CASE WHEN v_key_changed THEN 'KEYEDIT' ELSE 'UPDATE' END;

    INSERT INTO public.po_cost_log (po_cost_id, item_id, goodcode, product_name, vendor, moq, po_cost, po_cost_unit, activity, changes, user_id, user_email)
    VALUES (NEW.id, NEW.item_id, NEW.goodcode, NEW.product_name, NEW.vendor, NEW.moq, NEW.po_cost, NEW.po_cost_unit, v_activity, v_changes, v_uid, v_email);
    RETURN NEW;

  ELSIF (TG_OP = 'DELETE') THEN
    v_activity := 'DELETE';
    v_changes := jsonb_build_object(
      'moq', jsonb_build_object('old', OLD.moq, 'new', NULL),
      'po_cost', jsonb_build_object('old', OLD.po_cost, 'new', NULL)
    );
    INSERT INTO public.po_cost_log (po_cost_id, item_id, goodcode, product_name, vendor, moq, po_cost, po_cost_unit, activity, changes, user_id, user_email)
    VALUES (OLD.id, OLD.item_id, OLD.goodcode, OLD.product_name, OLD.vendor, OLD.moq, OLD.po_cost, OLD.po_cost_unit, v_activity, v_changes, v_uid, v_email);
    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_po_cost_changes ON public.po_cost;
CREATE TRIGGER trg_log_po_cost_changes
AFTER INSERT OR UPDATE OR DELETE ON public.po_cost
FOR EACH ROW EXECUTE FUNCTION public.log_po_cost_changes();

-- 3) Add Log sub-menu: log_po_cost
INSERT INTO public.menus (menu_code, menu_name, menu_type, parent_id, sort_order, is_active)
SELECT 'log_po_cost', 'Log - PO Cost', 'Sub', m.id, 1, true
FROM public.menus m
WHERE m.menu_code = 'log'
  AND NOT EXISTS (SELECT 1 FROM public.menus WHERE menu_code = 'log_po_cost');

-- 4) Auto-grant view to Admin role for the new sub-menu
INSERT INTO public.role_menu_permissions (role_id, menu_id, can_view, can_create, can_edit, can_delete, can_export)
SELECT r.id, m.id, true, true, true, true, true
FROM public.roles r
CROSS JOIN public.menus m
WHERE r.role_name = 'Admin'
  AND m.menu_code = 'log_po_cost'
  AND NOT EXISTS (
    SELECT 1 FROM public.role_menu_permissions rmp
    WHERE rmp.role_id = r.id AND rmp.menu_id = m.id
  );
