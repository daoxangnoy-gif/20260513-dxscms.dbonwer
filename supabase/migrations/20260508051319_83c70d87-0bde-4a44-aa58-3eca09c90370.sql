-- Revert: only owner or Admin can delete snapshots
DROP POLICY IF EXISTS "authenticated_delete_snapshots" ON public.srr_snapshots;
CREATE POLICY "authenticated_delete_snapshots"
ON public.srr_snapshots
FOR DELETE
TO authenticated
USING ((user_id = auth.uid()) OR has_role(auth.uid(), 'Admin'::text));

DROP POLICY IF EXISTS "authenticated_delete_d2s_snapshots" ON public.srr_d2s_snapshots;
CREATE POLICY "authenticated_delete_d2s_snapshots"
ON public.srr_d2s_snapshots
FOR DELETE
TO authenticated
USING ((user_id = auth.uid()) OR has_role(auth.uid(), 'Admin'::text));