-- Allow any authenticated user to delete snapshot docs (shared SRR workspace)
DROP POLICY IF EXISTS "authenticated_delete_snapshots" ON public.srr_snapshots;
CREATE POLICY "authenticated_delete_snapshots"
ON public.srr_snapshots
FOR DELETE
TO authenticated
USING (true);

DROP POLICY IF EXISTS "authenticated_delete_d2s_snapshots" ON public.srr_d2s_snapshots;
CREATE POLICY "authenticated_delete_d2s_snapshots"
ON public.srr_d2s_snapshots
FOR DELETE
TO authenticated
USING (true);