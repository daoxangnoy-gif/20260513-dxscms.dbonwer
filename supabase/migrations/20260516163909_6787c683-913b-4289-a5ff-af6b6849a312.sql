
-- Job assignments table
CREATE TABLE IF NOT EXISTS public.job_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  assignee_name text NOT NULL,
  content text NOT NULL,
  attachment_url text,
  attachment_name text,
  attachment_type text,
  due_date date NOT NULL,
  status text NOT NULL DEFAULT 'assigned',
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.job_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY auth_read_job_assignments ON public.job_assignments
  FOR SELECT TO authenticated USING (true);

CREATE POLICY auth_insert_job_assignments ON public.job_assignments
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

CREATE POLICY auth_update_job_assignments ON public.job_assignments
  FOR UPDATE TO authenticated
  USING ((user_id = auth.uid()) OR has_role(auth.uid(), 'Admin'));

CREATE POLICY auth_delete_job_assignments ON public.job_assignments
  FOR DELETE TO authenticated
  USING ((user_id = auth.uid()) OR has_role(auth.uid(), 'Admin'));

CREATE TRIGGER set_job_assignments_updated_at
  BEFORE UPDATE ON public.job_assignments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_job_assignments_user ON public.job_assignments(user_id);
CREATE INDEX idx_job_assignments_status ON public.job_assignments(status);

-- Storage bucket (private, signed URLs)
INSERT INTO storage.buckets (id, name, public)
VALUES ('job-assignments', 'job-assignments', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "auth_read_job_assignments_storage"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'job-assignments');

CREATE POLICY "auth_insert_job_assignments_storage"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'job-assignments' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "auth_update_job_assignments_storage"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'job-assignments' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "auth_delete_job_assignments_storage"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'job-assignments' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Register menu (sub of SRR)
INSERT INTO public.menus (menu_name, menu_code, menu_type, sort_order, is_active)
VALUES ('Job Assign', 'srr_job_assign', 'Sub', 60, true)
ON CONFLICT DO NOTHING;
