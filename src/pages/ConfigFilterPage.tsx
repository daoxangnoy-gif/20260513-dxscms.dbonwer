import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Pencil, Filter as FilterIcon } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import {
  FILTER_TABLES, OPERATORS, FilterRule, FilterTemplate, TABLE_APPLIES_TO, invalidateFilterTemplatesCache,
} from "@/lib/filterTemplates";

function emptyRule(defaultTable?: string): FilterRule {
  return { source_table: defaultTable, column: "", operator: "is_in", value: [], join: "AND" };
}

export default function ConfigFilterPage() {
  const { toast } = useToast();
  const { isAdmin } = useAuth();
  const [list, setList] = useState<FilterTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<FilterTemplate | null>(null);

  const [name, setName] = useState("");
  const [targetTable, setTargetTable] = useState("data_master");
  const [isActive, setIsActive] = useState(true);
  const [rules, setRules] = useState<FilterRule[]>([emptyRule()]);

  const load = async () => {
    setLoading(true);
    const { data, error } = await (supabase as any)
      .from("filter_templates").select("*").order("target_table").order("name");
    setLoading(false);
    if (error) { toast({ title: "Load failed", description: error.message, variant: "destructive" }); return; }
    setList((data || []) as FilterTemplate[]);
  };
  useEffect(() => { load(); }, []);

  const openNew = () => {
    const firstTbl = FILTER_TABLES.find(t => t.value === "data_master")?.tables[0]?.name;
    setEditing(null); setName(""); setTargetTable("data_master"); setIsActive(true);
    setRules([emptyRule(firstTbl)]); setOpen(true);
  };
  const openEdit = (t: FilterTemplate) => {
    const firstTbl = FILTER_TABLES.find(m => m.value === t.target_table)?.tables[0]?.name;
    setEditing(t); setName(t.name); setTargetTable(t.target_table); setIsActive(t.is_active);
    setRules(t.rules?.length ? t.rules : [emptyRule(firstTbl)]); setOpen(true);
  };

  const save = async () => {
    if (!name.trim()) { toast({ title: "ใส่ชื่อ Template", variant: "destructive" }); return; }
    const cleanRules = rules.filter(r => r.column && r.operator);
    const payload: any = { name: name.trim(), target_table: targetTable, is_active: isActive, rules: cleanRules };
    const { error } = editing
      ? await (supabase as any).from("filter_templates").update(payload).eq("id", editing.id)
      : await (supabase as any).from("filter_templates").insert(payload);
    if (error) { toast({ title: "Save failed", description: error.message, variant: "destructive" }); return; }
    toast({ title: "บันทึกแล้ว" });
    setOpen(false); invalidateFilterTemplatesCache(); load();
  };

  const remove = async (t: FilterTemplate) => {
    if (!confirm(`ลบ "${t.name}"?`)) return;
    const { error } = await (supabase as any).from("filter_templates").delete().eq("id", t.id);
    if (error) { toast({ title: "Delete failed", description: error.message, variant: "destructive" }); return; }
    toast({ title: "ลบแล้ว" });
    invalidateFilterTemplatesCache(); load();
  };

  const toggleActive = async (t: FilterTemplate) => {
    const { error } = await (supabase as any).from("filter_templates").update({ is_active: !t.is_active }).eq("id", t.id);
    if (error) { toast({ title: "Update failed", description: error.message, variant: "destructive" }); return; }
    invalidateFilterTemplatesCache(); load();
  };

  const menu = FILTER_TABLES.find(t => t.value === targetTable);
  const menuTables = menu?.tables || [];
  const cols = menu?.columns || [];

  return (
    <div className="p-6 space-y-4 h-full overflow-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><FilterIcon className="w-6 h-6" />Config - Filter</h1>
          <p className="text-sm text-muted-foreground">ตั้ง Default Filter (Exclude rule) ที่ระบบจะตัดข้อมูลออกอัตโนมัติทุกหน้า</p>
        </div>
        {isAdmin && <Button onClick={openNew}><Plus className="w-4 h-4 mr-1" />New Template</Button>}
      </div>

      <div className="border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Apply to Menu</TableHead>
              <TableHead>Template Name</TableHead>
              <TableHead>Conditions</TableHead>
              <TableHead className="text-center">Active</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">Loading…</TableCell></TableRow>}
            {!loading && list.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">ยังไม่มี template</TableCell></TableRow>}
            {list.map(t => {
              const menu = FILTER_TABLES.find(m => m.value === t.target_table);
              return (
              <TableRow key={t.id}>
                <TableCell>
                  <Badge variant="default" className="font-medium">{menu?.label || t.target_table}</Badge>
                </TableCell>
                <TableCell className="font-medium">{t.name}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {(!t.rules || t.rules.length === 0) && <span className="text-xs text-muted-foreground">—</span>}
                    {(t.rules || []).map((r, i) => (
                      <Badge key={i} variant="outline" className="text-[10px] font-mono">
                        {i > 0 && <span className="mr-1 text-muted-foreground">{r.join || "AND"}</span>}
                        {r.column} {r.operator.replace(/_/g, " ")} {Array.isArray(r.value) ? r.value.join("|") : (r.value ?? "")}
                      </Badge>
                    ))}
                  </div>
                </TableCell>
                <TableCell className="text-center">
                  <Switch checked={t.is_active} onCheckedChange={() => isAdmin && toggleActive(t)} disabled={!isAdmin} />
                </TableCell>
                <TableCell className="text-right space-x-1">
                  {isAdmin && <Button variant="ghost" size="sm" onClick={() => openEdit(t)}><Pencil className="w-4 h-4" /></Button>}
                  {isAdmin && <Button variant="ghost" size="sm" onClick={() => remove(t)}><Trash2 className="w-4 h-4 text-destructive" /></Button>}
                </TableCell>
              </TableRow>
            );})}
          </TableBody>
        </Table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? "Edit Template" : "New Template"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1 p-3 rounded-md bg-muted/40 border">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">Step 1 — เลือก Apply to Menu</Label>
              <Select value={targetTable} onValueChange={(v) => {
                setTargetTable(v);
                const firstTbl = FILTER_TABLES.find(t => t.value === v)?.tables[0]?.name;
                setRules([emptyRule(firstTbl)]);
              }}>
                <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {FILTER_TABLES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground pt-1">
                Template นี้จะมีผลเฉพาะหน้า <b>{FILTER_TABLES.find(t => t.value === targetTable)?.label}</b> (menu code: <code>{targetTable}</code>)
              </p>
            </div>
            <div className="space-y-1">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">Step 2 — ตั้งชื่อ Template</Label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder="เช่น Exclude Inactive Items" />
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={isActive} onCheckedChange={setIsActive} />
              <Label>Active (apply ทันที)</Label>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">Step 3 — Rules (ระบบจะ <b>ตัดออก</b> row ที่ตรงเงื่อนไข)</Label>
                <Button size="sm" variant="outline" onClick={() => setRules([...rules, emptyRule(menuTables[0]?.name)])}>
                  <Plus className="w-3 h-3 mr-1" />Add Rule
                </Button>
              </div>
              {rules.map((r, i) => {
                const op = OPERATORS.find(o => o.value === r.operator);
                const needsValue = op?.needsValue ?? true;
                const isMulti = op?.multi ?? false;
                const ruleSrc = r.source_table || menuTables[0]?.name || "";
                const ruleCols = menuTables.find(t => t.name === ruleSrc)?.columns || cols;
                return (
                  <div key={i} className="grid grid-cols-[70px_140px_1fr_1fr_1.5fr_36px] gap-2 items-center p-2 border rounded bg-muted/30">
                    {i === 0 ? <div className="text-xs text-muted-foreground text-center">WHERE</div> : (
                      <Select value={r.join || "AND"} onValueChange={(v) => {
                        const n = [...rules]; n[i] = { ...n[i], join: v as any }; setRules(n);
                      }}>
                        <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                        <SelectContent><SelectItem value="AND">AND</SelectItem><SelectItem value="OR">OR</SelectItem></SelectContent>
                      </Select>
                    )}
                    {/* Table picker (Step 3a) */}
                    <Select value={ruleSrc} onValueChange={(v) => {
                      const n = [...rules]; n[i] = { ...n[i], source_table: v, column: "" }; setRules(n);
                    }}>
                      <SelectTrigger className="h-8"><SelectValue placeholder="Table" /></SelectTrigger>
                      <SelectContent className="max-h-72">
                        {menuTables.map(t => <SelectItem key={t.name} value={t.name}>{t.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    {/* Column picker (Step 3b) — filtered by table */}
                    <Select value={r.column} onValueChange={(v) => { const n = [...rules]; n[i] = { ...n[i], column: v }; setRules(n); }}>
                      <SelectTrigger className="h-8"><SelectValue placeholder="Column" /></SelectTrigger>
                      <SelectContent className="max-h-72">
                        {ruleCols.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Select value={r.operator} onValueChange={(v) => { const n = [...rules]; n[i] = { ...n[i], operator: v as any, value: OPERATORS.find(o => o.value === v)?.multi ? [] : "" }; setRules(n); }}>
                      <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {OPERATORS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    {needsValue ? (
                      <Input
                        className="h-8"
                        placeholder={isMulti ? "value1, value2, value3" : "value"}
                        value={Array.isArray(r.value) ? r.value.join(", ") : (r.value ?? "")}
                        onChange={(e) => {
                          const n = [...rules];
                          n[i] = { ...n[i], value: isMulti ? e.target.value.split(",").map(s => s.trim()).filter(Boolean) : e.target.value };
                          setRules(n);
                        }}
                      />
                    ) : <div className="text-xs text-muted-foreground text-center">—</div>}
                    <Button size="sm" variant="ghost" onClick={() => setRules(rules.filter((_, j) => j !== i))} disabled={rules.length === 1}>
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  </div>
                );
              })}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={!isAdmin}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
