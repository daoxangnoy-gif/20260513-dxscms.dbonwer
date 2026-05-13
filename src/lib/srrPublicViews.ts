import { supabase } from "@/integrations/supabase/client";

export type SrrViewScope = "dc" | "direct";
export interface SrrPublicView {
  id: string;
  name: string;
  columns: string[];
}

export async function listPublicViews(scope: SrrViewScope): Promise<SrrPublicView[]> {
  const { data, error } = await supabase
    .from("srr_public_column_views")
    .select("id, name, columns")
    .eq("scope", scope)
    .order("name");
  if (error) throw error;
  return (data || []).map(r => ({
    id: r.id,
    name: r.name,
    columns: Array.isArray(r.columns) ? (r.columns as string[]) : [],
  }));
}

// Upsert by (scope, name). Existing record is replaced.
export async function savePublicView(
  scope: SrrViewScope,
  name: string,
  columns: string[],
): Promise<void> {
  const { data: userRes } = await supabase.auth.getUser();
  const created_by = userRes?.user?.id ?? null;
  const { error } = await supabase
    .from("srr_public_column_views")
    .upsert(
      { scope, name, columns, created_by },
      { onConflict: "scope,name" },
    );
  if (error) throw error;
}

export async function deletePublicView(id: string): Promise<void> {
  const { error } = await supabase
    .from("srr_public_column_views")
    .delete()
    .eq("id", id);
  if (error) throw error;
}
