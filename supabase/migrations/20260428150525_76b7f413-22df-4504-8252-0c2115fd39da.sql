DROP FUNCTION IF EXISTS public.get_srr_data(text[], text[], text[], text[], text[], text[], text[], text[], text[], text[]);
DROP FUNCTION IF EXISTS public.get_srr_d2s_data(text[], text[], text[], text[], text[], text[], text[], text[], text[], text[]);

GRANT EXECUTE ON FUNCTION public.get_srr_data(text[], text[], text[], text[], text[], text[], text[], text[], text[], text[], text[]) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.get_srr_d2s_data(text[], text[], text[], text[], text[], text[], text[], text[], text[], text[], text[]) TO authenticated, anon;