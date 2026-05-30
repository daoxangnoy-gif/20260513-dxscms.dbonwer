// Edge function: admin updates another user's auth (email/password) + profile fields
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.replace("Bearer ", "");
    if (!jwt) return json({ error: "Missing auth" }, 401);

    // Verify caller
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) return json({ error: "Unauthorized" }, 401);

    // Check Admin
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: roleRow } = await admin
      .from("user_roles")
      .select("roles(role_name)")
      .eq("user_id", userData.user.id)
      .maybeSingle();
    const roleName = (roleRow as any)?.roles?.role_name;
    if (roleName !== "Admin") return json({ error: "Forbidden: Admin only" }, 403);

    const body = await req.json();
    const { target_user_id, email, password, full_name, phone, department } = body || {};
    if (!target_user_id) return json({ error: "Missing target_user_id" }, 400);

    // Update auth (email/password) if provided
    const authUpdate: Record<string, any> = {};
    if (email && typeof email === "string") authUpdate.email = email;
    if (password && typeof password === "string" && password.length >= 6) authUpdate.password = password;
    if (Object.keys(authUpdate).length > 0) {
      const { error: authErr } = await admin.auth.admin.updateUserById(target_user_id, authUpdate);
      if (authErr) return json({ error: `Auth update failed: ${authErr.message}` }, 400);
    }

    // Update profile fields
    const profileUpdate: Record<string, any> = {};
    if (typeof full_name === "string") profileUpdate.full_name = full_name;
    if (typeof phone === "string") profileUpdate.phone = phone || null;
    if (typeof department === "string") profileUpdate.department = department || null;
    if (typeof email === "string") profileUpdate.email = email;
    if (Object.keys(profileUpdate).length > 0) {
      const { error: pErr } = await admin
        .from("profiles")
        .update(profileUpdate)
        .eq("user_id", target_user_id);
      if (pErr) return json({ error: `Profile update failed: ${pErr.message}` }, 400);
    }

    return json({ ok: true });
  } catch (e: any) {
    return json({ error: e.message || String(e) }, 500);
  }
});

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
