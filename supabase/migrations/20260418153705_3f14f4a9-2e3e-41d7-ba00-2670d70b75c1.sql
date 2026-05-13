-- Allow Admin to insert/update/delete roles
CREATE POLICY "admin_insert_roles" ON public.roles
FOR INSERT TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'Admin'));

CREATE POLICY "admin_update_roles" ON public.roles
FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(), 'Admin'))
WITH CHECK (public.has_role(auth.uid(), 'Admin'));

CREATE POLICY "admin_delete_roles" ON public.roles
FOR DELETE TO authenticated
USING (public.has_role(auth.uid(), 'Admin'));