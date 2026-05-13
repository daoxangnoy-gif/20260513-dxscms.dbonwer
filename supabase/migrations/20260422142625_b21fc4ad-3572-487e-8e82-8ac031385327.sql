ALTER TABLE public.srr_snapshots ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'filter';
CREATE INDEX IF NOT EXISTS idx_srr_snapshots_source ON public.srr_snapshots(source);