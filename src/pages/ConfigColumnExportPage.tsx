import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { Plus, Trash2, ArrowUp, ArrowDown, Copy, CheckCircle2, Pencil, Loader2, Settings2 } from "lucide-react";
import {
  ExportTemplate, TargetMenu, TARGET_MENUS,
  TemplateColumn, ConditionType,
  listTemplates, invalidateTemplateCache,
} from "@/lib/exportTemplate";

// Field whitelist by source table — keeps dropdown sane
const TABLE_FIELDS: Record<string, string[]> = {
  srr_row: [
    "partner_id", "Picking Type / Database ID", "Inter Transfer", "PO Group",
    "Products to Purchase/barcode", "Products to Purchase/Product", "Product name",
    "Products to Purchase/UoM", "Products to Purchase/Exclude In Package",
    "Products to Purchase/Quantity", "Products to Purchase/Unit Price",
    "assigned_to", "description",
    "vendor_code", "vendor_name", "sku_code", "main_barcode", "product_name_la",
    "unit_of_measure", "final_suggest_qty", "po_cost_unit", "moq", "po_group",
    "order_uom_edit", "store_name", "type_store", "ship_to", "spc_name",
  ],
  data_master: [
    "sku_code", "main_barcode", "barcode", "product_name_la", "product_name_en",
    "unit_of_measure", "packing_size_qty", "vendor_code", "vendor_display_name",
    "item_type", "buying_status", "po_group", "brand", "house_brand",
    "division_group", "division", "department", "sub_department", "class", "sub_class",
    "standard_price", "list_price", "min_order_pcs", "dc_min_stock",
  ],
  vendor_master: [
    "vendor_code", "vendor_name_en", "vendor_name_la", "vendor_origin",
    "vendor_type", "vendor_payment_terms", "supplier_currency", "trade_term",
    "leadtime", "order_cycle", "spc_name", "order_day", "delivery_day", "vat_percent",
  ],
  po_cost: ["item_id", "vendor", "po_cost", "po_cost_unit", "moq", "product_name", "goodcode"],
  store_type: ["store_name", "type_store", "size_store", "code", "ship_to", "type_doc"],
};

const TABLES = Object.keys(TABLE_FIELDS);

const CONDITION_LABELS: Record<"field" | "constant" | "conditional", string> = {
  field: "Field — ใช้ค่าจาก Data From",
  constant: "Constant — ค่าคงที่",
  conditional: "Conditional — if/else",
};

const SCOPE_LABELS: Record<"all_row" | "first_row", string> = {
  all_row: "All Row — ทุกแถว",
  first_row: "First Row — แถวแรก",
};

// Normalize legacy condition.type ("all_row"/"first_row") into new {type:'field', scope:...}
function normalizeCondition(c: any) {
  if (!c) return { type: "field", scope: "all_row" };
  if (c.type === "all_row") return { ...c, type: "field", scope: c.scope ?? "all_row" };
  if (c.type === "first_row") return { ...c, type: "field", scope: c.scope ?? "first_row" };
  return { scope: "all_row", ...c };
}

function newColumn(): TemplateColumn {
  return { header: "", source: { table: "srr_row", field: "" }, condition: { type: "field", scope: "all_row" } as any };
}

export default function ConfigColumnExportPage() {
  const { user } = useAuth();
  const [items, setItems] = useState<ExportTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<ExportTemplate | null>(null);
  const [filterMenu, setFilterMenu] = useState<TargetMenu | "all">("all");

  const load = async () => {
    setLoading(true);
    try {
      setItems(await listTemplates());
    } catch (e: any) {
      toast({ title: "โหลดล้มเหลว", description: e.message, variant: "destructive" });
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const startNew = (menu?: TargetMenu) => {
    setEditing({
      id: "",
      name: "",
      target_menu: menu || "srr_dc_po",
      is_active: false,
      columns: [newColumn()],
      created_by: user?.id || null,
      created_at: "",
      updated_at: "",
    });
  };

  const startClone = (t: ExportTemplate) => {
    setEditing({ ...t, id: "", name: `${t.name} (Copy)`, is_active: false, created_at: "", updated_at: "" });
  };

  const toggleActive = async (t: ExportTemplate) => {
    try {
      if (!t.is_active) {
        // deactivate others of same menu
        await supabase.from("export_templates").update({ is_active: false }).eq("target_menu", t.target_menu);
      }
      const { error } = await supabase
        .from("export_templates")
        .update({ is_active: !t.is_active })
        .eq("id", t.id);
      if (error) throw error;
      invalidateTemplateCache(t.target_menu);
      toast({ title: !t.is_active ? "Activated" : "Deactivated" });
      load();
    } catch (e: any) {
      toast({ title: "เปลี่ยนสถานะล้มเหลว", description: e.message, variant: "destructive" });
    }
  };

  const removeOne = async (t: ExportTemplate) => {
    if (!confirm(`ลบ template "${t.name}" ?`)) return;
    const { error } = await supabase.from("export_templates").delete().eq("id", t.id);
    if (error) return toast({ title: "ลบไม่สำเร็จ", description: error.message, variant: "destructive" });
    invalidateTemplateCache(t.target_menu);
    load();
  };

  const visible = filterMenu === "all" ? items : items.filter(i => i.target_menu === filterMenu);
  const grouped = TARGET_MENUS.map(m => ({ menu: m, items: visible.filter(v => v.target_menu === m.value) }));

  return (
    <div className="h-full flex flex-col overflow-hidden bg-background">
      <div className="border-b px-6 py-4 flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2"><Settings2 className="w-5 h-5" />Config Column Export</h1>
          <p className="text-xs text-muted-foreground mt-0.5">จัดการ Template หัวคอลัมน์/แหล่งข้อมูล/condition ของ Excel export (DC / D2S / Special PO·RO·SO)</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={filterMenu} onValueChange={v => setFilterMenu(v as any)}>
            <SelectTrigger className="h-8 w-[260px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">ทุกเมนู</SelectItem>
              {TARGET_MENUS.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button size="sm" onClick={() => startNew(filterMenu === "all" ? undefined : filterMenu)}>
            <Plus className="w-3.5 h-3.5 mr-1" />New Template
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6 space-y-6">
        {loading && <div className="flex items-center justify-center h-40"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>}
        {!loading && grouped.map(g => (
          <div key={g.menu.value} className="border rounded-lg overflow-hidden">
            <div className="bg-muted/40 px-4 py-2 flex items-center justify-between">
              <div className="text-sm font-semibold">{g.menu.label}</div>
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => startNew(g.menu.value)}>
                <Plus className="w-3 h-3 mr-1" />Add
              </Button>
            </div>
            {g.items.length === 0 ? (
              <div className="px-4 py-6 text-xs text-muted-foreground text-center">
                ยังไม่มี template — fallback ใช้รูปแบบ export เดิม
              </div>
            ) : (
              <div className="divide-y">
                {g.items.map(t => (
                  <div key={t.id} className="px-4 py-2.5 flex items-center gap-3">
                    {t.is_active
                      ? <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 gap-1"><CheckCircle2 className="w-3 h-3" />Active</Badge>
                      : <Badge variant="outline">Inactive</Badge>}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{t.name}</div>
                      <div className="text-[10px] text-muted-foreground">{t.columns.length} columns • updated {new Date(t.updated_at).toLocaleString("th-TH")}</div>
                    </div>
                    <Button size="sm" variant={t.is_active ? "outline" : "default"} className="h-7 text-xs" onClick={() => toggleActive(t)}>
                      {t.is_active ? "Deactivate" : "Activate"}
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditing(t)}><Pencil className="w-3 h-3" /></Button>
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => startClone(t)}><Copy className="w-3 h-3" /></Button>
                    <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive" onClick={() => removeOne(t)}><Trash2 className="w-3 h-3" /></Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {editing && (
        <TemplateEditor
          template={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </div>
  );
}

function TemplateEditor({ template, onClose, onSaved }: { template: ExportTemplate; onClose: () => void; onSaved: () => void }) {
  const { user } = useAuth();
  const [t, setT] = useState<ExportTemplate>(template);
  const [saving, setSaving] = useState(false);

  const update = (patch: Partial<ExportTemplate>) => setT(prev => ({ ...prev, ...patch }));

  const setCol = (idx: number, patch: Partial<TemplateColumn>) => {
    setT(prev => ({
      ...prev,
      columns: prev.columns.map((c, i) => i === idx ? { ...c, ...patch } : c),
    }));
  };
  const addCol = () => setT(prev => ({ ...prev, columns: [...prev.columns, newColumn()] }));
  const delCol = (idx: number) => setT(prev => ({ ...prev, columns: prev.columns.filter((_, i) => i !== idx) }));

  // Normalize legacy conditions on mount
  useEffect(() => {
    setT(prev => ({ ...prev, columns: prev.columns.map(c => ({ ...c, condition: normalizeCondition(c.condition) as any })) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const moveCol = (idx: number, dir: -1 | 1) => {
    const j = idx + dir;
    if (j < 0 || j >= t.columns.length) return;
    const arr = [...t.columns];
    [arr[idx], arr[j]] = [arr[j], arr[idx]];
    setT(prev => ({ ...prev, columns: arr }));
  };

  const save = async () => {
    if (!t.name.trim()) return toast({ title: "ใส่ชื่อ template", variant: "destructive" });
    if (t.columns.length === 0) return toast({ title: "ต้องมีอย่างน้อย 1 column", variant: "destructive" });
    if (t.columns.some(c => !c.header.trim())) return toast({ title: "Header ห้ามว่าง", variant: "destructive" });
    setSaving(true);
    try {
      // If activating, deactivate others first
      if (t.is_active) {
        await supabase.from("export_templates").update({ is_active: false })
          .eq("target_menu", t.target_menu).neq("id", t.id || "00000000-0000-0000-0000-000000000000");
      }
      const payload = {
        name: t.name.trim(),
        target_menu: t.target_menu,
        is_active: t.is_active,
        columns: t.columns as any,
        created_by: t.created_by || user?.id || null,
      };
      if (t.id) {
        const { error } = await supabase.from("export_templates").update(payload).eq("id", t.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("export_templates").insert(payload);
        if (error) throw error;
      }
      invalidateTemplateCache(t.target_menu);
      toast({ title: "บันทึกสำเร็จ" });
      onSaved();
    } catch (e: any) {
      toast({ title: "บันทึกล้มเหลว", description: e.message, variant: "destructive" });
    }
    setSaving(false);
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>{t.id ? "Edit Template" : "New Template"}</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-3 gap-3 py-2">
          <div>
            <Label className="text-xs">ชื่อ Template</Label>
            <Input value={t.name} onChange={e => update({ name: e.target.value })} className="h-8 text-sm" />
          </div>
          <div>
            <Label className="text-xs">Target Menu</Label>
            <Select value={t.target_menu} onValueChange={v => update({ target_menu: v as TargetMenu })}>
              <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                {TARGET_MENUS.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end gap-2">
            <Switch checked={t.is_active} onCheckedChange={c => update({ is_active: c })} />
            <Label className="text-xs mb-1.5">Active กับเมนูนี้ (จะปิดของเดิมอัตโนมัติ)</Label>
          </div>
        </div>

        <div className="flex-1 overflow-auto border rounded">
          <table className="w-full text-xs">
            <thead className="bg-muted/50 sticky top-0">
              <tr>
                <th className="px-2 py-1.5 w-8">#</th>
                <th className="px-2 py-1.5 text-left">Column Header</th>
                <th className="px-2 py-1.5 text-left w-[260px]">Data From (Table . Field)</th>
                <th className="px-2 py-1.5 text-left w-[340px]">Condition</th>
                <th className="px-2 py-1.5 text-left w-[110px]">Scope</th>
                <th className="px-2 py-1.5 w-24"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {t.columns.map((c, i) => {
                const cond: any = c.condition || { type: "field", scope: "all_row" };
                const condType: "field" | "constant" | "conditional" =
                  cond.type === "all_row" || cond.type === "first_row" ? "field" : cond.type;
                const legacyScopeFromType: "all_row" | "first_row" | undefined =
                  cond.type === "first_row" ? "first_row" : cond.type === "all_row" ? "all_row" : undefined;
                const scope: "all_row" | "first_row" = cond.scope ?? legacyScopeFromType ?? "all_row";
                const srrFields = TABLE_FIELDS.srr_row;
                return (
                <tr key={i} className="align-top">
                  <td className="px-2 py-1.5 text-center text-muted-foreground">{i + 1}</td>
                  <td className="px-2 py-1.5">
                    <Input value={c.header} onChange={e => setCol(i, { header: e.target.value })} className="h-7 text-xs" placeholder="ชื่อคอลัมน์ที่จะ export" />
                  </td>
                  <td className="px-2 py-1.5 space-y-1">
                    <Select
                      value={c.source?.table || "__none__"}
                      onValueChange={v => setCol(i, { source: v === "__none__" ? null : { table: v, field: "" } })}
                    >
                      <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Table" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">— (ไม่ใช้ source)</SelectItem>
                        {TABLES.map(tb => <SelectItem key={tb} value={tb}>{tb}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    {c.source && (
                      <Select
                        value={c.source.field || "__pick__"}
                        onValueChange={v => setCol(i, { source: { table: c.source!.table, field: v } })}
                      >
                        <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Field" /></SelectTrigger>
                        <SelectContent className="max-h-[300px]">
                          <SelectItem value="__pick__" disabled>— เลือก field —</SelectItem>
                          {(TABLE_FIELDS[c.source.table] || []).map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    )}
                  </td>
                  <td className="px-2 py-1.5 space-y-1">
                    <Select value={condType} onValueChange={v => setCol(i, { condition: { ...cond, type: v as any } as any })}>
                      <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {Object.entries(CONDITION_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    {condType === "constant" && (
                      <Input
                        value={cond.value || ""}
                        onChange={e => setCol(i, { condition: { ...cond, value: e.target.value } as any })}
                        className="h-7 text-xs"
                        placeholder='ค่าคงที่ เช่น "True" หรือ "2540"'
                      />
                    )}
                    {condType === "conditional" && (
                      <div className="space-y-1 border rounded p-1.5 bg-muted/20">
                        <div className="text-[10px] text-muted-foreground">IF</div>
                        <div className="grid grid-cols-2 gap-1">
                          <Select value={cond.if_field || "__pick__"} onValueChange={v => setCol(i, { condition: { ...cond, if_field: v } as any })}>
                            <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="field" /></SelectTrigger>
                            <SelectContent className="max-h-[260px]">
                              <SelectItem value="__pick__" disabled>— field —</SelectItem>
                              {srrFields.map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}
                            </SelectContent>
                          </Select>
                          <Input value={cond.if_equals || ""} onChange={e => setCol(i, { condition: { ...cond, if_equals: e.target.value } as any })} className="h-7 text-xs" placeholder="= value" />
                        </div>
                        <div className="text-[10px] text-muted-foreground">THEN</div>
                        <div className="grid grid-cols-[80px_1fr] gap-1">
                          <Select value={cond.then_mode || "value"} onValueChange={v => setCol(i, { condition: { ...cond, then_mode: v as any } as any })}>
                            <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="value">Value</SelectItem>
                              <SelectItem value="field">Field</SelectItem>
                            </SelectContent>
                          </Select>
                          {(cond.then_mode || "value") === "value" ? (
                            <Input value={cond.then_value || ""} onChange={e => setCol(i, { condition: { ...cond, then_value: e.target.value } as any })} className="h-7 text-xs" placeholder='ใส่ค่า (รองรับ ${field})' />
                          ) : (
                            <Select value={cond.then_field || "__pick__"} onValueChange={v => setCol(i, { condition: { ...cond, then_field: v } as any })}>
                              <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="field" /></SelectTrigger>
                              <SelectContent className="max-h-[260px]">
                                <SelectItem value="__pick__" disabled>— field —</SelectItem>
                                {srrFields.map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          )}
                        </div>
                        <div className="text-[10px] text-muted-foreground">ELSE</div>
                        <div className="grid grid-cols-[80px_1fr] gap-1">
                          <Select value={cond.else_mode || "value"} onValueChange={v => setCol(i, { condition: { ...cond, else_mode: v as any } as any })}>
                            <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="value">Value</SelectItem>
                              <SelectItem value="field">Field</SelectItem>
                            </SelectContent>
                          </Select>
                          {(cond.else_mode || "value") === "value" ? (
                            <Input value={cond.else_value || ""} onChange={e => setCol(i, { condition: { ...cond, else_value: e.target.value } as any })} className="h-7 text-xs" placeholder='ใส่ค่า (รองรับ ${field})' />
                          ) : (
                            <Select value={cond.else_field || "__pick__"} onValueChange={v => setCol(i, { condition: { ...cond, else_field: v } as any })}>
                              <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="field" /></SelectTrigger>
                              <SelectContent className="max-h-[260px]">
                                <SelectItem value="__pick__" disabled>— field —</SelectItem>
                                {srrFields.map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          )}
                        </div>
                      </div>
                    )}
                  </td>
                  <td className="px-2 py-1.5">
                    <Select value={scope} onValueChange={v => setCol(i, { condition: { ...cond, type: condType, scope: v as any } as any })}>
                      <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {Object.entries(SCOPE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="px-2 py-1.5">
                    <div className="flex items-center justify-end gap-0.5">
                      <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => moveCol(i, -1)}><ArrowUp className="w-3 h-3" /></Button>
                      <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => moveCol(i, 1)}><ArrowDown className="w-3 h-3" /></Button>
                      <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-destructive" onClick={() => delCol(i)}><Trash2 className="w-3 h-3" /></Button>
                    </div>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between pt-2">
          <Button size="sm" variant="outline" onClick={addCol}><Plus className="w-3.5 h-3.5 mr-1" />Add Column</Button>
          <DialogFooter>
            <Button size="sm" variant="outline" onClick={onClose}>ยกเลิก</Button>
            <Button size="sm" onClick={save} disabled={saving}>
              {saving && <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />}บันทึก
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
