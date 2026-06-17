import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Tag, Plus, Trash2, Loader2 } from "lucide-react";

type BrandRow = { id?: string; code: number; brand_name: string; branch: string };

export default function SRROrderB2BInternalPage() {
  const [activeTab, setActiveTab] = useState("brand");
  const { toast } = useToast();

  // --- List Brand dialog ---
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<BrandRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const openDialog = async () => {
    setOpen(true);
    setLoading(true);
    try {
      const { data, error } = await (supabase as any)
        .from("brand")
        .select("id, code, brand_name, branch")
        .order("code", { ascending: true });
      if (error) throw error;
      setRows(
        (data || []).map((r: any) => ({
          id: r.id,
          code: r.code,
          brand_name: r.brand_name ?? "",
          branch: r.branch ?? "",
        })),
      );
    } catch (e: any) {
      toast({ title: "โหลดข้อมูลไม่สำเร็จ", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const addRow = () => {
    setRows((prev) => [...prev, { code: prev.length ? Math.max(...prev.map((r) => r.code)) + 1 : 1, brand_name: "", branch: "" }]);
  };

  const removeRow = (idx: number) => setRows((prev) => prev.filter((_, i) => i !== idx));

  const updateRow = (idx: number, field: "brand_name" | "branch", value: string) =>
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, [field]: value } : r)));

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = rows.map((r) => ({ code: r.code, brand_name: r.brand_name.trim(), branch: r.branch.trim() }));
      const { error } = await (supabase as any).from("brand").upsert(payload, { onConflict: "code" });
      if (error) throw error;
      toast({ title: "บันทึกสำเร็จ", description: `บันทึก ${payload.length} Brand` });
      setOpen(false);
    } catch (e: any) {
      toast({ title: "บันทึกไม่สำเร็จ", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden">
        <div className="border-b px-4 pt-3">
          <TabsList className="h-8">
            <TabsTrigger value="brand" className="text-xs gap-1.5">
              <Tag className="w-3.5 h-3.5" /> Brand control
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="brand" className="flex-1 overflow-auto mt-0 p-4 bg-background">
          <Button size="sm" onClick={openDialog} className="gap-1.5">
            <Tag className="w-4 h-4" /> List Brand
          </Button>
        </TabsContent>
      </Tabs>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>List Brand</DialogTitle>
          </DialogHeader>

          {loading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
            </div>
          ) : (
            <div className="max-h-[55vh] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted">
                  <tr className="text-left">
                    <th className="px-2 py-1.5 w-20 font-medium">Code</th>
                    <th className="px-2 py-1.5 font-medium">Brand name</th>
                    <th className="px-2 py-1.5 font-medium">Branch</th>
                    <th className="px-2 py-1.5 w-10" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, idx) => (
                    <tr key={idx} className="border-b">
                      <td className="px-2 py-1 text-muted-foreground tabular-nums">{row.code}</td>
                      <td className="px-2 py-1">
                        <Input
                          value={row.brand_name}
                          onChange={(e) => updateRow(idx, "brand_name", e.target.value)}
                          className="h-8"
                          placeholder="Brand name"
                        />
                      </td>
                      <td className="px-2 py-1">
                        <Input
                          value={row.branch}
                          onChange={(e) => updateRow(idx, "branch", e.target.value)}
                          className="h-8"
                          placeholder="Branch"
                        />
                      </td>
                      <td className="px-2 py-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => removeRow(idx)}>
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-2 py-6 text-center text-muted-foreground">
                        ยังไม่มีข้อมูล กดปุ่ม + เพื่อเพิ่ม
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>

              <Button variant="outline" size="sm" onClick={addRow} className="mt-2 gap-1.5">
                <Plus className="w-4 h-4" /> เพิ่ม
              </Button>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving || loading}>
              {saving && <Loader2 className="w-4 h-4 animate-spin mr-1.5" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
