import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Tag, Plus, Trash2, Loader2, Search, Copy } from "lucide-react";

type BrandRow = { id?: string; code: number; brand_name: string; branch: string };

export default function SRROrderB2BInternalPage() {
  const [activeTab, setActiveTab] = useState("brand");
  const { toast } = useToast();

  // --- List Brand dialog ---
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<BrandRow[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const openDialog = async () => {
    setOpen(true);
    setSearch("");
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

  const duplicateRow = (idx: number) =>
    setRows((prev) => {
      const src = prev[idx];
      const newCode = prev.length ? Math.max(...prev.map((r) => r.code)) + 1 : 1;
      const copy: BrandRow = { code: newCode, brand_name: src.brand_name, branch: src.branch };
      const next = [...prev];
      next.splice(idx + 1, 0, copy);
      return next;
    });

  const updateRow = (idx: number, field: "brand_name" | "branch", value: string) =>
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, [field]: value } : r)));

  const q = search.trim().toLowerCase();
  const visibleRows = rows
    .map((row, idx) => ({ row, idx }))
    .filter(
      ({ row }) =>
        !q ||
        row.brand_name.toLowerCase().includes(q) ||
        row.branch.toLowerCase().includes(q) ||
        String(row.code).includes(q),
    );

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
              <div className="relative mb-2">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-8 pl-8"
                  placeholder="ค้นหา Code / Brand name / Branch"
                />
              </div>

              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted">
                  <tr className="text-left">
                    <th className="px-2 py-1.5 w-20 font-medium">Code</th>
                    <th className="px-2 py-1.5 font-medium">Brand name</th>
                    <th className="px-2 py-1.5 font-medium">Branch</th>
                    <th className="px-2 py-1.5 w-20" />
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map(({ row, idx }) => (
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
                        <div className="flex items-center gap-0.5">
                          <Button variant="ghost" size="icon" className="h-7 w-7" title="Duplicate" onClick={() => duplicateRow(idx)}>
                            <Copy className="w-4 h-4 text-muted-foreground" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7" title="ลบ" onClick={() => removeRow(idx)}>
                            <Trash2 className="w-4 h-4 text-destructive" />
                          </Button>
                        </div>
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
                  {rows.length > 0 && visibleRows.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-2 py-6 text-center text-muted-foreground">
                        ไม่พบรายการที่ค้นหา
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
