ALTER TABLE public.saved_po_documents ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'filter';
CREATE INDEX IF NOT EXISTS idx_saved_po_documents_source ON public.saved_po_documents(source);