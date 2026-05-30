
CREATE OR REPLACE FUNCTION public.get_assignable_users()
RETURNS TABLE (user_id uuid, full_name text, phone text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.user_id, p.full_name, p.phone
  FROM public.profiles p
  WHERE p.is_active = true
    AND p.full_name IS NOT NULL
    AND length(trim(p.full_name)) > 0
  ORDER BY p.full_name;
$$;

GRANT EXECUTE ON FUNCTION public.get_assignable_users() TO authenticated;
