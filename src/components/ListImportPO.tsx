import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Download, ChevronDown, ChevronUp as ChevronUpIcon,
  CheckSquare, XCircle, Trash2, Search, X, FileSpreadsheet,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import * as XLSX from "xlsx";
import { remapRowsByTemplate, type TargetMenu } from "@/lib/exportTemplate";
import type { SavedPO } from "@/lib/srrTypes";
import { applyHighPrecisionFormat, stripSeconds, formatLocalBatchLabel } from "@/lib/srrUtils";

// Re-export for consumers that previously imported from SRRPage
export { applyHighPrecisionFormat } from "@/lib/srrUtils";
export { getLocalPOBatches } from "@/lib/srrUtils";

function resolveMenuFromStorageKey(storageKey: string): TargetMenu | null {
  if (storageKey === "srr_saved_pos") return "srr_dc_po";
  if (storageKey === "srr_saved_pos_special") return "srr_special_po";
  if (storageKey === "srr_saved_pos_d2s") return "srr_d2s_po";
  return null;
}

export function ListImportPO({
  storageKey = "srr_saved_pos",
  title = "List Import PO",
  selectedBatchValues = [],
  refreshKey = 0,
  onDataChange,
}: {
  storageKey?: string;
  title?: string;
  selectedBatchValues?: string[];
  refreshKey?: number;
  onDataChange?: () => void;
} = {}) {
  const loadPOs = () => { try { return JSON.parse(localStorage.getItem(storageKey) || "[]"); } catch { return []; } };
  const persistPOs = (pos: SavedPO[]) => {
    try { localStorage.setItem(storageKey, JSON.stringify(pos)); }
    catch (e) {
      console.error("localStorage save failed:", e);
      if (pos.length > 10) { try { localStorage.setItem(storageKey, JSON.stringify(pos.slice(-10))); } catch { } }
      throw new Error("พื้นที่จัดเก็บเต็ม กรุณาลบ PO เก่าก่อน");
    }
  };
  const [savedPOs, setSavedPOs] = useState<SavedPO[]>(loadPOs());
  const [previewPO, setPreviewPO] = useState<SavedPO | null>(null);
  const [selectedPOs, setSelectedPOs] = useState<Set<string>>(new Set());
  const [expandedSPCs, setExpandedSPCs] = useState<Set<string>>(new Set());
  const [searchValue, setSearchValue] = useState("");
  const { toast } = useToast();

  useEffect(() => { setSavedPOs(loadPOs()); }, [storageKey, refreshKey]);

  const selectedBatchSeconds = useMemo(
    () => new Set(selectedBatchValues.map((v) => String(v).slice(0, 19))),
    [selectedBatchValues],
  );

  const filteredPOs = useMemo(() => {
    let rows = savedPOs;
    if (selectedBatchSeconds.size > 0)
      rows = rows.filter((po) => po.date && selectedBatchSeconds.has(String(po.date).slice(0, 19)));
    if (!searchValue.trim()) return rows;
    const q = searchValue.toLowerCase();
    return rows.filter(po =>
      po.name?.toLowerCase().includes(q) || po.vendor_code?.toLowerCase().includes(q) ||
      po.vendor_name?.toLowerCase().includes(q) || po.spc_name?.toLowerCase().includes(q)
    );
  }, [savedPOs, searchValue, selectedBatchSeconds]);

  const grouped = useMemo(() => {
    const map = new Map<string, Map<string, SavedPO[]>>();
    for (const po of filteredPOs) {
      const spcKey = po.spc_name || po.rows?.[0]?.spc_name || "Unknown SPC";
      const dateKey = po.date ? po.date.substring(0, 10) : "Unknown Date";
      if (!map.has(spcKey)) map.set(spcKey, new Map());
      const dateMap = map.get(spcKey)!;
      if (!dateMap.has(dateKey)) dateMap.set(dateKey, []);
      dateMap.get(dateKey)!.push(po);
    }
    return map;
  }, [filteredPOs]);

  const toggleSelect = (id: string) => {
    setSelectedPOs(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };
  const selectAll = () => setSelectedPOs(new Set(filteredPOs.map(p => p.id)));
  const unselectAll = () => setSelectedPOs(new Set());
  const selectGroup = (spcKey: string) => {
    const dateMap = grouped.get(spcKey);
    if (!dateMap) return;
    setSelectedPOs(prev => {
      const next = new Set(prev);
      for (const pos of dateMap.values()) for (const po of pos) next.add(po.id);
      return next;
    });
  };
  const selectDateGroup = (spcKey: string, dateKey: string) => {
    const pos = grouped.get(spcKey)?.get(dateKey);
    if (!pos) return;
    setSelectedPOs(prev => { const next = new Set(prev); for (const po of pos) next.add(po.id); return next; });
  };
  const toggleSPC = (spcKey: string) => {
    setExpandedSPCs(prev => { const n = new Set(prev); n.has(spcKey) ? n.delete(spcKey) : n.add(spcKey); return n; });
  };
  const expandAll = () => setExpandedSPCs(new Set(grouped.keys()));
  const collapseAll = () => setExpandedSPCs(new Set());
  const deletePO = (id: string) => {
    const updated = savedPOs.filter(p => p.id !== id);
    persistPOs(updated); setSavedPOs(updated); onDataChange?.();
    selectedPOs.delete(id); setSelectedPOs(new Set(selectedPOs));
    toast({ title: "ลบเอกสารสำเร็จ" });
  };
  const deleteSelected = () => {
    if (selectedPOs.size === 0) return;
    const updated = savedPOs.filter(p => !selectedPOs.has(p.id));
    persistPOs(updated); setSavedPOs(updated); onDataChange?.();
    toast({ title: "ลบเอกสารสำเร็จ", description: `ลบ ${selectedPOs.size} เอกสาร` });
    setSelectedPOs(new Set());
  };
  const deleteAll = () => {
    persistPOs([]); setSavedPOs([]); onDataChange?.(); setSelectedPOs(new Set());
    toast({ title: "ลบเอกสารทั้งหมดสำเร็จ" });
  };
  const exportSelected = async () => {
    const toExport = savedPOs.filter(p => selectedPOs.has(p.id));
    if (toExport.length === 0) { toast({ title: "กรุณาเลือกเอกสาร", variant: "destructive" }); return; }
    const wb = XLSX.utils.book_new();
    const menu = resolveMenuFromStorageKey(storageKey);
    const allRows: any[] = [];
    for (const po of toExport) {
      const mapped = menu ? await remapRowsByTemplate(menu, po.rows) : po.rows;
      allRows.push(...mapped);
    }
    const ws = XLSX.utils.json_to_sheet(allRows);
    applyHighPrecisionFormat(ws);
    XLSX.utils.book_append_sheet(wb, ws, "Combined PO");
    const now = new Date();
    const ts = now.getFullYear().toString() + String(now.getMonth() + 1).padStart(2, "0") + String(now.getDate()).padStart(2, "0") + String(now.getHours()).padStart(2, "0") + String(now.getMinutes()).padStart(2, "0") + String(now.getSeconds()).padStart(2, "0");
    XLSX.writeFile(wb, `${ts} - MultiVendor_Combined.xlsx`);
    toast({ title: "Export สำเร็จ", description: `${toExport.length} เอกสาร, ${allRows.length} แถว` });
  };
  const exportSingle = async (po: SavedPO) => {
    const wb = XLSX.utils.book_new();
    const menu = resolveMenuFromStorageKey(storageKey);
    const rows = menu ? await remapRowsByTemplate(menu, po.rows) : po.rows;
    const ws = XLSX.utils.json_to_sheet(rows);
    applyHighPrecisionFormat(ws);
    XLSX.utils.book_append_sheet(wb, ws, po.vendor_code.substring(0, 31));
    XLSX.writeFile(wb, `${po.name}.xlsx`);
    toast({ title: "Export สำเร็จ" });
  };
  const isSPCAllSelected = (spcKey: string) => {
    const dateMap = grouped.get(spcKey);
    if (!dateMap) return false;
    for (const pos of dateMap.values()) for (const po of pos) if (!selectedPOs.has(po.id)) return false;
    return true;
  };
  const isDateAllSelected = (spcKey: string, dateKey: string) => {
    const pos = grouped.get(spcKey)?.get(dateKey);
    if (!pos) return false;
    return pos.every(po => selectedPOs.has(po.id));
  };

  return (
    <div className="flex flex-col h-full animate-fade-in">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-card">
        <div>
          <h1 className="text-lg font-bold text-foreground">{title}</h1>
          <p className="text-xs text-muted-foreground">{savedPOs.length} เอกสาร · {grouped.size} กลุ่ม SPC</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input placeholder="ค้นหา Vendor, SPC..." value={searchValue} onChange={e => setSearchValue(e.target.value)} className="h-8 w-48 pl-7 text-xs" />
            {searchValue && (
              <button onClick={() => setSearchValue("")} className="absolute right-2 top-1/2 -translate-y-1/2">
                <X className="w-3 h-3 text-muted-foreground" />
              </button>
            )}
          </div>
          <Button size="sm" variant="outline" onClick={selectAll} className="text-xs"><CheckSquare className="w-3.5 h-3.5 mr-1" /> Select All</Button>
          <Button size="sm" variant="outline" onClick={unselectAll} className="text-xs" disabled={selectedPOs.size === 0}><XCircle className="w-3.5 h-3.5 mr-1" /> Unselect</Button>
          <Button size="sm" variant="ghost" onClick={expandedSPCs.size === grouped.size ? collapseAll : expandAll} className="text-xs">
            {expandedSPCs.size === grouped.size ? <ChevronUpIcon className="w-3.5 h-3.5 mr-1" /> : <ChevronDown className="w-3.5 h-3.5 mr-1" />}
            {expandedSPCs.size === grouped.size ? "Collapse All" : "Expand All"}
          </Button>
          {selectedPOs.size > 0 && (
            <>
              <Button size="sm" onClick={exportSelected} className="text-xs"><Download className="w-3.5 h-3.5 mr-1" /> Export ({selectedPOs.size})</Button>
              <Button size="sm" variant="destructive" onClick={deleteSelected} className="text-xs"><Trash2 className="w-3.5 h-3.5 mr-1" /> Delete ({selectedPOs.size})</Button>
            </>
          )}
          <Button size="sm" variant="destructive" onClick={deleteAll} className="text-xs" disabled={savedPOs.length === 0}><Trash2 className="w-3.5 h-3.5 mr-1" /> Delete All</Button>
        </div>
      </div>
      <div className="flex-1 overflow-auto p-4">
        {savedPOs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
            <FileSpreadsheet className="w-12 h-12 mb-3 opacity-30" />
            <p className="text-sm">ยังไม่มีเอกสาร PO ที่บันทึก</p>
            <p className="text-xs mt-1">กด "Save" ในหน้า SRR DC ITEM หลังคำนวณเสร็จ</p>
          </div>
        ) : filteredPOs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
            <FileSpreadsheet className="w-12 h-12 mb-3 opacity-30" />
            <p className="text-sm">ไม่พบเอกสารตามช่วงวันที่ที่เลือก</p>
            <p className="text-xs mt-1">ลองกด Clear ที่ Dropdown Date เพื่อดูทั้งหมด</p>
          </div>
        ) : (
          <div className="space-y-1">
            {[...grouped.entries()].map(([spcKey, dateMap]) => {
              const isExpanded = expandedSPCs.has(spcKey);
              const spcAllSelected = isSPCAllSelected(spcKey);
              let totalItems = 0;
              for (const pos of dateMap.values()) totalItems += pos.length;
              return (
                <div key={spcKey} className="border border-border rounded-lg overflow-hidden">
                  <div className={cn("flex items-center gap-2 px-3 py-2.5 cursor-pointer transition-colors", "bg-muted/60 hover:bg-muted")} onClick={() => toggleSPC(spcKey)}>
                    {isExpanded ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground rotate-[-90deg]" />}
                    <Checkbox
                      checked={spcAllSelected}
                      onCheckedChange={(e) => { e && typeof e !== "string" ? selectGroup(spcKey) : (() => { const dm = grouped.get(spcKey); if (dm) setSelectedPOs(prev => { const next = new Set(prev); for (const pos of dm.values()) for (const po of pos) next.delete(po.id); return next; }); })(); }}
                      onClick={(e) => e.stopPropagation()}
                      className="h-4 w-4"
                    />
                    <span className="text-sm font-semibold text-foreground">{spcKey}</span>
                    <span className="text-xs text-muted-foreground ml-auto">{totalItems} เอกสาร · {dateMap.size} วัน</span>
                  </div>
                  {isExpanded && (
                    <div className="border-t border-border">
                      {[...dateMap.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([dateKey, pos]) => {
                        const dateAllSelected = isDateAllSelected(spcKey, dateKey);
                        return (
                          <div key={dateKey}>
                            <div className="flex items-center gap-2 px-6 py-1.5 bg-muted/30 border-b border-border/50">
                              <Checkbox checked={dateAllSelected} onCheckedChange={(checked) => { if (checked) selectDateGroup(spcKey, dateKey); else setSelectedPOs(prev => { const next = new Set(prev); for (const po of pos) next.delete(po.id); return next; }); }} className="h-3.5 w-3.5" />
                              <span className="text-xs font-medium text-muted-foreground">📅 {dateKey}</span>
                              <span className="text-[10px] text-muted-foreground/70 ml-auto">{pos.length} เอกสาร</span>
                            </div>
                            {pos.map(po => (
                              <div key={po.id} className={cn("flex items-center gap-3 px-8 py-2 border-b border-border/30 cursor-pointer transition-colors", selectedPOs.has(po.id) ? "bg-primary/5" : "hover:bg-muted/30")}>
                                <Checkbox checked={selectedPOs.has(po.id)} onCheckedChange={() => toggleSelect(po.id)} className="h-3.5 w-3.5" />
                                <div className="flex-1 min-w-0" onDoubleClick={() => setPreviewPO(po)}>
                                  <p className="text-sm font-medium truncate">{stripSeconds(po.name)}</p>
                                  <p className="text-xs text-muted-foreground truncate">{po.vendor_code} - {po.vendor_name} · {po.rows.length} รายการ · {po.pickingType}</p>
                                </div>
                                <Button size="sm" variant="ghost" className="text-xs h-7 w-7 p-0" onClick={() => exportSingle(po)}><Download className="w-3.5 h-3.5" /></Button>
                                <Button size="sm" variant="ghost" className="text-xs h-7 w-7 p-0 text-destructive" onClick={() => deletePO(po.id)}><X className="w-3.5 h-3.5" /></Button>
                              </div>
                            ))}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
      <Dialog open={!!previewPO} onOpenChange={() => setPreviewPO(null)}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Preview: {previewPO ? stripSeconds(previewPO.name) : ""}</DialogTitle></DialogHeader>
          {previewPO && (
            <div className="overflow-auto max-h-[60vh]">
              <table className="w-full border-collapse text-xs">
                <thead><tr>{Object.keys(previewPO.rows[0] || {}).map(k => <th key={k} className="data-table-header">{k}</th>)}</tr></thead>
                <tbody>{previewPO.rows.map((r, i) => <tr key={i} className="border-b border-border">{Object.values(r).map((v, j) => <td key={j} className="data-table-cell">{String(v ?? "")}</td>)}</tr>)}</tbody>
              </table>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPreviewPO(null)}>ปิด</Button>
            {previewPO && <Button onClick={() => exportSingle(previewPO)}><Download className="w-3.5 h-3.5 mr-1" /> Export</Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
