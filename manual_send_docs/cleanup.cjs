/* Delete test shipments created by the manual-capture run (sign in as the test user). */
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  "https://umgyeygujkhysgrmvavz.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVtZ3lleWd1amtoeXNncm12YXZ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1MDU3MTEsImV4cCI6MjA5NDA4MTcxMX0.bIbafjVsZPf-8HqFZ6auS_z7Mju5UwxyN3aR4dSw-mg"
);

(async () => {
  const { error: authErr } = await supabase.auth.signInWithPassword({
    email: "docshiptest@mail.com",
    password: "docshiptest123456789",
  });
  if (authErr) throw authErr;

  const { data: ships, error: selErr } = await supabase
    .from("document_shipments")
    .select("id, doc_name, depositor_name")
    .eq("depositor_name", "ทดสอบ-ผู้ฝาก");
  if (selErr) throw selErr;
  console.log("found:", ships.map((s) => s.doc_name));

  for (const s of ships) {
    const { error: mvErr } = await supabase.from("document_movements").delete().eq("shipment_id", s.id);
    if (mvErr) console.log("movements delete error:", s.doc_name, mvErr.message);
    const { error: shErr } = await supabase.from("document_shipments").delete().eq("id", s.id);
    console.log(shErr ? `FAILED ${s.doc_name}: ${shErr.message}` : `deleted ${s.doc_name}`);
  }

  const { data: left } = await supabase
    .from("document_shipments")
    .select("id")
    .eq("depositor_name", "ทดสอบ-ผู้ฝาก");
  console.log("remaining:", (left || []).length);
})().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
