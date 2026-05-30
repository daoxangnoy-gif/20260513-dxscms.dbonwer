import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Upload, Download, Trash2, Loader2, Search, RefreshCw, FileSpreadsheet } from "lucide-react";
import * as XLSX from "xlsx";

interface Row {
  id: string;
  sku_code: string;
  store_name: string;
  product_name_la: string | null;
  product_name_en: string | null;
  created_at: string;
}

export default function SARSkuNoOrderTab() {
  const { toast } = useToast();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const all: Row[] = [];
      let offset = 0;
      const PAGE = 1000;
      while (true) {
        const { data, error } = await (supabase as any)
          .from("sku_no_order")
          .select("id,sku_code,store_name,product_name_la,product_name_en,created_at")
          .order("created_at", { ascending: false })
          .range(offset, offset + PAGE - 1);
        if (error) throw error;
        const batch = (data || []) as Row[];
        all.push(...batch);
        if (batch.length < PAGE) break;
        offset += PAGE;
      }
      setRows(all);
      setSelected(new Set());
    } catch (e: any) {
      toast({ title: "Load error", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const downloadTemplate = () => {
    const ws = XLSX.utils.json_to_sheet([
      { "skucode/barcode": "0001234", store_name: "Jmart Sikai" },
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Template");
    XLSX.writeFile(wb, "SkuNoOrder_Template.xlsx");
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setImporting(true);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json<any>(ws);
      const norm = (s: string) => String(s || "").toLowerCase().replace(/[\s_\-\/\\.]+/g, "");
      const sample = json[0] || {};
      const keyMap: Record<string, string> = {};
      for (const k of Object.keys(sample)) {
        const n = norm(k);
        if (n === "skucode" || n === "sku" || n === "barcode" || n === "mainbarcode" || n === "skucodebarcode" || n === "barcodeskucode") keyMap[k] = "key";
        else if (n === "storename" || n === "store") keyMap[k] = "store_name";
      }
      const kKey = Object.keys(keyMap).find(k => keyMap[k] === "key");
      const sKey = Object.keys(keyMap).find(k => keyMap[k] === "store_name");
      if (!kKey || !sKey) {
        toast({ title: "Import Error", description: "ต้องมีคอลัมน์: skucode/barcode, store_name", variant: "destructive" });
        return;
      }

      type Item = { key: string; store: string };
      const items: Item[] = [];
      for (const r of json) {
        const key = String(r[kKey] ?? "").trim();
        const store = String(r[sKey] ?? "").trim();
        if (!key || !store) continue;
        items.push({ key, store });
      }
      if (items.length === 0) {
        toast({ title: "ไม่มีข้อมูลที่ถูกต้อง", variant: "destructive" });
        return;
      }

      const uniqueKeys = Array.from(new Set(items.map(i => i.key)));
      const skuByKey = new Map<string, { sku: string; la: string | null; en: string | null }>();
      const CHUNK = 500;
      for (let i = 0; i < uniqueKeys.length; i += CHUNK) {
        const slice = uniqueKeys.slice(i, i + CHUNK);
        const inExpr = slice.map(s => `"${s.replace(/"/g, '""')}"`).join(",");
        const { data, error } = await supabase
          .from("data_master")
          .select("sku_code, main_barcode, barcode, product_name_la, product_name_en")
          .or(`sku_code.in.(${inExpr}),main_barcode.in.(${inExpr}),barcode.in.(${inExpr})`);
        if (error) throw error;
        for (const m of data || []) {
          const info = { sku: m.sku_code!, la: m.product_name_la, en: m.product_name_en };
          if (m.sku_code && slice.includes(m.sku_code)) skuByKey.set(m.sku_code, info);
          if (m.main_barcode && slice.includes(m.main_barcode)) skuByKey.set(m.main_barcode, info);
          if (m.barcode && slice.includes(m.barcode)) skuByKey.set(m.barcode, info);
        }
      }

      const inserts: any[] = [];
      let skipped = 0;
      for (const it of items) {
        const info = skuByKey.get(it.key);
        if (!info) { skipped++; continue; }
        inserts.push({
          sku_code: info.sku,
          store_name: it.store,
          product_name_la: info.la,
          product_name_en: info.en,
        });
      }
      if (inserts.length === 0) {
        toast({ title: "ไม่พบรายการใน Master", description: `skip ${skipped} แถว`, variant: "destructive" });
        return;
      }
      const { error: insErr } = await (supabase as any).from("sku_no_order").insert(inserts);
      if (insErr) throw insErr;
      toast({ title: "Import สำเร็จ", description: `เพิ่ม ${inserts.length} แถว · skip ${skipped} แถว` });
      await load();
    } catch (err: any) {
      toast({ title: "Import Error", description: err.message, variant: "destructive" });
    } finally {
      setImporting(false);
    }
  };

  const deleteRow = async (id: string) => {
    if (!confirm("ลบรายการนี้?")) return;
    const { error } = await (supabase as any).from("sku_no_order").delete().eq("id", id);
    if (error) { toast({ title: "Delete Error", description: error.message, variant: "destructive" }); return; }
    setRows(r => r.filter(x => x.id !== id));
    setSelected(s => { const n = new Set(s); n.delete(id); return n; });
  };

  const deleteAll = async () => {
    if (!confirm(`ลบทั้งหมด ${rows.length} แถว?`)) return;
    const { error } = await (supabase as any).from("sku_no_order").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    if (error) { toast({ title: "Delete Error", description: error.message, variant: "destructive" }); return; }
    setRows([]);
    setSelected(new Set());
    toast({ title: "ลบทั้งหมดสำเร็จ" });
  };

  const filtered = useMemo(() => rows.filter(r => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return r.sku_code.toLowerCase().includes(q) ||
      (r.product_name_la || "").toLowerCase().includes(q) ||
      (r.product_name_en || "").toLowerCase().includes(q) ||
      (r.store_name || "").toLowerCase().includes(q);
  }), [rows, search]);

  const allFilteredChecked = filtered.length > 0 && filtered.every(r => selected.has(r.id));
  const toggleAll = (c: boolean) => {
    setSelected(prev => {
      const n = new Set(prev);
      if (c) filtered.forEach(r => n.add(r.id));
      else filtered.forEach(r => n.delete(r.id));
      return n;
    });
  };
  const toggleOne = (id: string, c: boolean) => {
    setSelected(prev => {
      const n = new Set(prev);
      if (c) n.add(id); else n.delete(id);
      return n;
    });
  };

  const exportRows = (list: Row[], suffix: string) => {
    if (list.length === 0) {
      toast({ title: "ไม่มีข้อมูลให้ Export", variant: "destructive" });
      return;
    }
    const ws = XLSX.utils.json_to_sheet(list.map(r => ({
      "SKU Code": r.sku_code,
      "Product Name (LA)": r.product_name_la || "",
      "Product Name (EN)": r.product_name_en || "",
      "Store Name": r.store_name,
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "SkuNoOrder");
    const ts = new Date();
    const stamp = `${ts.getFullYear()}${String(ts.getMonth()+1).padStart(2,"0")}${String(ts.getDate()).padStart(2,"0")}_${String(ts.getHours()).padStart(2,"0")}${String(ts.getMinutes()).padStart(2,"0")}`;
    XLSX.writeFile(wb, `SkuNoOrder_${suffix}_${stamp}.xlsx`);
  };

  const exportTotal = () => exportRows(rows, "total");
  const exportSelected = () => exportRows(rows.filter(r => selected.has(r.id)), "selected");

  return (
    <div className="px-4 py-2 space-y-2 h-full flex flex-col min-h-0">
      <div className="flex items-center gap-2 flex-wrap">
        <Button size="sm" variant="outline" onClick={downloadTemplate}>
          <Download className="w-4 h-4 mr-1" /> Template
        </Button>
        <label className="cursor-pointer">
          <input type="file" accept=".xlsx,.csv" className="hidden" onChange={handleImport} disabled={importing} />
          <span className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 gap-1">
            {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            Import
          </span>
        </label>
        <Button size="sm" variant="outline" onClick={load} disabled={loading}>
          <RefreshCw className={`w-4 h-4 mr-1 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
        <Button size="sm" variant="outline" onClick={exportTotal} disabled={rows.length === 0}>
          <FileSpreadsheet className="w-4 h-4 mr-1" /> Export Total ({rows.length.toLocaleString()})
        </Button>
        <Button size="sm" variant="outline" onClick={exportSelected} disabled={selected.size === 0}>
          <FileSpreadsheet className="w-4 h-4 mr-1" /> Export Selected ({selected.size.toLocaleString()})
        </Button>
        {rows.length > 0 && (
          <Button size="sm" variant="destructive" onClick={deleteAll}>
            <Trash2 className="w-4 h-4 mr-1" /> Delete All ({rows.length})
          </Button>
        )}
        <div className="flex items-center gap-1 ml-auto">
          <Search className="w-4 h-4 text-muted-foreground" />
          <Input placeholder="ค้นหา..." value={search} onChange={e => setSearch(e.target.value)} className="h-8 w-64 text-xs" />
        </div>
      </div>

      <div className="flex-1 overflow-auto border rounded">
        <table className="w-full text-xs">
          <thead className="bg-muted sticky top-0 z-10">
            <tr>
              <th className="px-2 py-1.5 w-8">
                <Checkbox checked={allFilteredChecked} onCheckedChange={c => toggleAll(!!c)} />
              </th>
              <th className="px-2 py-1.5 text-left">SKU Code</th>
              <th className="px-2 py-1.5 text-left">Product Name (LA)</th>
              <th className="px-2 py-1.5 text-left">Product Name (EN)</th>
              <th className="px-2 py-1.5 text-left">Store Name</th>
              <th className="px-2 py-1.5 w-12"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(r => (
              <tr key={r.id} className="border-t hover:bg-muted/50">
                <td className="px-2 py-1">
                  <Checkbox checked={selected.has(r.id)} onCheckedChange={c => toggleOne(r.id, !!c)} />
                </td>
                <td className="px-2 py-1 font-mono">{r.sku_code}</td>
                <td className="px-2 py-1">{r.product_name_la}</td>
                <td className="px-2 py-1">{r.product_name_en}</td>
                <td className="px-2 py-1">{r.store_name}</td>
                <td className="px-2 py-1">
                  <button onClick={() => deleteRow(r.id)} className="text-destructive hover:opacity-70">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={6} className="text-center py-8 text-muted-foreground">
                {loading ? "กำลังโหลด..." : "ไม่มีข้อมูล — กด Import เพื่อเพิ่ม"}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="text-xs text-muted-foreground">
        แสดง {filtered.length.toLocaleString()} / {rows.length.toLocaleString()} แถว · เลือก {selected.size.toLocaleString()}
      </div>
    </div>
  );
}
