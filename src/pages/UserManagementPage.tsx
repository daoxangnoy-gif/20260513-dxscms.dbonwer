import { useState, useEffect, useMemo, Fragment } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Pencil, Shield, Search, Plus, Trash2, Save, CheckCircle2 } from "lucide-react";

// Column definitions per menu_code (used for Column-level permissions)
// Key MUST match the actual menu_code in DB so column perms only show
// when that menu's "View" is ticked.
// Tab definitions per menu_code (used for Tab-level CRUD permissions)
const TAB_DEFS: Record<string, { label: string; tabs: { key: string; label: string }[] }> = {
  dc_item: {
    label: "SRR DC ITEM",
    tabs: [
      { key: "read-cal", label: "Read & Cal" },
      { key: "show-edit", label: "Show & Edit" },
      { key: "list-po", label: "List PO" },
      { key: "report", label: "Report" },
      { key: "report2", label: "Report 2" },
    ],
  },
  direct_item: {
    label: "SRR DIRECT ITEM",
    tabs: [
      { key: "read-cal", label: "Read & Cal" },
      { key: "show-edit", label: "Show & Edit" },
      { key: "list-po", label: "List PO" },
      { key: "report", label: "Report" },
      { key: "report2", label: "Report 2" },
    ],
  },
  special_order: {
    label: "Special Order",
    tabs: [
      { key: "order", label: "Order" },
      { key: "document", label: "Document" },
      { key: "list-po", label: "List Import PO" },
    ],
  },
  order_b2b: {
    label: "Order B2B",
    tabs: [
      { key: "data", label: "Data View" },
      { key: "so", label: "SO Doc" },
      { key: "po", label: "PO Doc" },
      { key: "ro", label: "RO Doc" },
    ],
  },
  sar: {
    label: "SAR",
    tabs: [
      { key: "read-cal", label: "Read & Cal" },
      { key: "on-order-dc", label: "On Order DC" },
      { key: "sku-no-order", label: "SKU No Order" },
    ],
  },
  srr_send_docs: {
    label: "ส่งเอกสาร",
    tabs: [
      { key: "origin", label: "ต้นทาง" },
      { key: "destination", label: "ปลายทาง" },
      { key: "compare", label: "เปรียบเทียบ" },
    ],
  },
};


const COLUMN_DEFS: Record<string, { label: string; columns: { key: string; label: string }[] }> = {
  dc_item: {
    label: "SRR DC ITEM",
    columns: [
      { key: "po_cost", label: "PO Cost" }, { key: "po_cost_unit", label: "PO Cost / Unit" },
      { key: "moq", label: "MOQ" }, { key: "stock_dc", label: "Stock DC" },
      { key: "min_jmart", label: "Min Jmart" }, { key: "max_jmart", label: "Max Jmart" },
      { key: "min_kokkok", label: "Min Kokkok" }, { key: "max_kokkok", label: "Max Kokkok" },
      { key: "min_udee", label: "Min U-dee" }, { key: "max_udee", label: "Max U-dee" },
      { key: "suggest_qty", label: "Suggest Qty" }, { key: "po_qty", label: "PO Qty (edit)" },
    ],
  },
  direct_item: {
    label: "SRR DIRECT ITEM",
    columns: [
      { key: "po_cost", label: "PO Cost" }, { key: "moq", label: "MOQ" },
      { key: "stock_store", label: "Stock Store" }, { key: "min_store", label: "Min Store" },
      { key: "max_store", label: "Max Store" }, { key: "suggest_qty", label: "Suggest Qty" },
      { key: "po_qty", label: "PO Qty (edit)" },
    ],
  },
  special_order: {
    label: "Special Order",
    columns: [
      { key: "po_cost", label: "PO Cost" }, { key: "moq", label: "MOQ" },
      { key: "min_store", label: "Min Store" }, { key: "max_store", label: "Max Store" },
      { key: "stock_store", label: "Stock Store" }, { key: "avg_store", label: "Avg/Day Store" },
      { key: "po_qty", label: "PO Qty (edit)" },
    ],
  },
  data_control: {
    label: "Data Control",
    columns: [
      { key: "po_cost", label: "PO Cost" }, { key: "list_price", label: "List Price" },
      { key: "standard_price", label: "Standard Price" }, { key: "vendor_code", label: "Vendor Code" },
      { key: "min_val", label: "Min Value" }, { key: "max_val", label: "Max Value" },
    ],
  },
};

interface UserRow {
  user_id: string;
  full_name: string;
  email: string;
  phone: string | null;
  department: string | null;
  spc_name: string | null;
  vendor_code: string | null;
  is_active: boolean;
  role_name: string;
  role_id: string;
}

interface RoleOption { id: string; role_name: string; description?: string | null; }
interface MenuRow { id: string; menu_code: string; menu_name: string; menu_type: string; parent_id: string | null; sort_order: number; }
interface RmpRow {
  id?: string; role_id: string; menu_id: string;
  can_view: boolean; can_create: boolean; can_edit: boolean; can_delete: boolean; can_export: boolean; can_import: boolean;
}
interface ColPermRow { id?: string; role_id: string; menu_code: string; column_key: string; access: "hidden" | "read" | "write"; }
interface TabPermRow {
  id?: string; role_id: string; menu_code: string; tab_key: string;
  can_view: boolean; can_create: boolean; can_edit: boolean; can_delete: boolean; can_export: boolean; can_import: boolean;
}
interface DivAccessRow {
  id?: string; role_id: string; division: string;
  can_view: boolean; can_create: boolean; can_edit: boolean; can_delete: boolean; can_export: boolean; can_import: boolean;
}

export default function UserManagementPage() {
  const { isAdmin, refreshPermissions } = useAuth();
  const { toast } = useToast();
  const [tab, setTab] = useState("users");

  // ===== USERS =====
  const [users, setUsers] = useState<UserRow[]>([]);
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showActiveOnly, setShowActiveOnly] = useState(false);
  const [showPendingOnly, setShowPendingOnly] = useState(false);
  const [editUser, setEditUser] = useState<UserRow | null>(null);
  const [editRole, setEditRole] = useState("");
  const [editSpc, setEditSpc] = useState("");
  const [editVendor, setEditVendor] = useState("");
  const [editActive, setEditActive] = useState(true);
  const [editFullName, setEditFullName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editDepartment, setEditDepartment] = useState("");
  const [editPassword, setEditPassword] = useState("");
  const [saving, setSaving] = useState(false);

  // ===== ROLES =====
  const [menus, setMenus] = useState<MenuRow[]>([]);
  const [selectedRole, setSelectedRole] = useState<string>("");
  const [rmpRows, setRmpRows] = useState<RmpRow[]>([]);
  const [colPerms, setColPerms] = useState<ColPermRow[]>([]);
  const [tabPerms, setTabPerms] = useState<TabPermRow[]>([]);
  const [divAccess, setDivAccess] = useState<DivAccessRow[]>([]);
  const [allDivisions, setAllDivisions] = useState<string[]>([]);
  const [divSearch, setDivSearch] = useState("");
  const [savingRole, setSavingRole] = useState(false);
  const [newRoleName, setNewRoleName] = useState("");
  const [showNewRole, setShowNewRole] = useState(false);

  const loadUsers = async () => {
    setLoading(true);
    const [profilesRes, rolesRes, userRolesRes] = await Promise.all([
      supabase.from("profiles").select("*"),
      supabase.from("roles").select("*").order("role_name"),
      supabase.from("user_roles").select("*, roles(role_name)"),
    ]);
    const rolesList = (rolesRes.data || []) as RoleOption[];
    setRoles(rolesList);
    const urMap = new Map<string, { role_name: string; role_id: string }>();
    for (const ur of (userRolesRes.data || []) as any[]) {
      urMap.set(ur.user_id, { role_name: ur.roles?.role_name || "Unknown", role_id: ur.role_id });
    }
    const userRows: UserRow[] = (profilesRes.data || []).map((p: any) => ({
      user_id: p.user_id, full_name: p.full_name || "", email: p.email || "",
      phone: p.phone, department: p.department,
      spc_name: p.spc_name, vendor_code: p.vendor_code, is_active: p.is_active,
      role_name: urMap.get(p.user_id)?.role_name || "—",
      role_id: urMap.get(p.user_id)?.role_id || "",
    }));
    setUsers(userRows);
    setLoading(false);
  };

  const loadMenus = async () => {
    const { data } = await supabase.from("menus").select("id, menu_code, menu_name, menu_type, parent_id, sort_order").eq("is_active", true).order("sort_order");
    setMenus((data || []) as MenuRow[]);
  };

  const loadDivisions = async () => {
    // Get distinct non-null divisions from data_master
    const { data } = await (supabase as any)
      .from("data_master")
      .select("division")
      .not("division", "is", null)
      .limit(5000);
    const set = new Set<string>();
    for (const r of (data || []) as any[]) {
      const d = (r.division || "").trim();
      if (d) set.add(d);
    }
    setAllDivisions(Array.from(set).sort());
  };

  useEffect(() => { loadUsers(); loadMenus(); loadDivisions(); }, []);

  const loadRolePerms = async (roleId: string) => {
    if (!roleId) { setRmpRows([]); setColPerms([]); setTabPerms([]); setDivAccess([]); return; }
    const [rmpRes, cpRes, tpRes, daRes] = await Promise.all([
      supabase.from("role_menu_permissions").select("*").eq("role_id", roleId),
      (supabase as any).from("column_permissions").select("*").eq("role_id", roleId),
      (supabase as any).from("tab_permissions").select("*").eq("role_id", roleId),
      (supabase as any).from("role_division_access").select("*").eq("role_id", roleId),
    ]);
    setRmpRows((rmpRes.data || []) as RmpRow[]);
    setColPerms((cpRes.data || []) as ColPermRow[]);
    setTabPerms((tpRes.data || []) as TabPermRow[]);
    setDivAccess((daRes.data || []) as DivAccessRow[]);
  };

  useEffect(() => { loadRolePerms(selectedRole); }, [selectedRole]);

  const openEdit = (u: UserRow) => {
    setEditUser(u);
    setEditRole(u.role_id);
    setEditSpc(u.spc_name || "");
    setEditVendor(u.vendor_code || "");
    setEditActive(u.is_active);
    setEditFullName(u.full_name || "");
    setEditEmail(u.email || "");
    setEditPhone(u.phone || "");
    setEditDepartment(u.department || "");
    setEditPassword("");
  };

  const saveUser = async () => {
    if (!editUser) return;
    setSaving(true);
    try {
      // 1) Auth + profile main fields (via edge function, admin only)
      const needAuth =
        (editEmail && editEmail !== editUser.email) ||
        (editPassword && editPassword.length >= 6) ||
        editFullName !== (editUser.full_name || "") ||
        editPhone !== (editUser.phone || "") ||
        editDepartment !== (editUser.department || "");
      if (needAuth) {
        const { data, error } = await supabase.functions.invoke("admin-update-user", {
          body: {
            target_user_id: editUser.user_id,
            email: editEmail !== editUser.email ? editEmail : undefined,
            password: editPassword && editPassword.length >= 6 ? editPassword : undefined,
            full_name: editFullName,
            phone: editPhone,
            department: editDepartment,
          },
        });
        if (error) throw error;
        if ((data as any)?.error) throw new Error((data as any).error);
      }
      // 2) SPC / Vendor / Active (direct, admin policy allows it)
      await supabase.from("profiles").update({
        spc_name: editSpc || null, vendor_code: editVendor || null, is_active: editActive,
      }).eq("user_id", editUser.user_id);
      if (editRole && editRole !== editUser.role_id) {
        await supabase.from("user_roles").delete().eq("user_id", editUser.user_id);
        await supabase.from("user_roles").insert({ user_id: editUser.user_id, role_id: editRole });
      } else if (!editUser.role_id && editRole) {
        await supabase.from("user_roles").insert({ user_id: editUser.user_id, role_id: editRole });
      }
      toast({ title: "บันทึกสำเร็จ" });
      setEditUser(null); loadUsers();
    } catch (e: any) {
      toast({ title: "เกิดข้อผิดพลาด", description: e.message, variant: "destructive" });
    } finally { setSaving(false); }
  };

  const quickApprove = async (u: UserRow, roleId: string) => {
    try {
      await supabase.from("profiles").update({ is_active: true }).eq("user_id", u.user_id);
      if (!u.role_id) {
        await supabase.from("user_roles").insert({ user_id: u.user_id, role_id: roleId });
      }
      toast({ title: "อนุมัติแล้ว", description: u.full_name });
      loadUsers();
    } catch (e: any) {
      toast({ title: "เกิดข้อผิดพลาด", description: e.message, variant: "destructive" });
    }
  };

  // ===== ROLE matrix helpers =====
  const getRmp = (menuId: string): RmpRow => {
    const r = rmpRows.find(x => x.menu_id === menuId);
    return r || { role_id: selectedRole, menu_id: menuId, can_view: false, can_create: false, can_edit: false, can_delete: false, can_export: false, can_import: false };
  };
  const setRmpField = (menuId: string, field: keyof RmpRow, value: boolean) => {
    setRmpRows(prev => {
      const idx = prev.findIndex(x => x.menu_id === menuId);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], [field]: value };
        if (field === "can_view" && !value) {
          next[idx] = { ...next[idx], can_create: false, can_edit: false, can_delete: false, can_export: false, can_import: false };
        }
        return next;
      }
      const base: RmpRow = { role_id: selectedRole, menu_id: menuId, can_view: false, can_create: false, can_edit: false, can_delete: false, can_export: false, can_import: false };
      return [...prev, { ...base, [field]: value }];
    });
  };

  const getColAccess = (menuCode: string, columnKey: string): "hidden" | "read" | "write" => {
    const r = colPerms.find(x => x.menu_code === menuCode && x.column_key === columnKey);
    return r?.access || "write";
  };
  const setColAccess = (menuCode: string, columnKey: string, access: "hidden" | "read" | "write") => {
    setColPerms(prev => {
      const idx = prev.findIndex(x => x.menu_code === menuCode && x.column_key === columnKey);
      if (idx >= 0) { const next = [...prev]; next[idx] = { ...next[idx], access }; return next; }
      return [...prev, { role_id: selectedRole, menu_code: menuCode, column_key: columnKey, access }];
    });
  };

  const getTabPerm = (menuCode: string, tabKey: string): TabPermRow => {
    const r = tabPerms.find(x => x.menu_code === menuCode && x.tab_key === tabKey);
    return r || { role_id: selectedRole, menu_code: menuCode, tab_key: tabKey, can_view: false, can_create: false, can_edit: false, can_delete: false, can_export: false, can_import: false };
  };
  const setTabPermField = (menuCode: string, tabKey: string, field: keyof TabPermRow, value: boolean) => {
    setTabPerms(prev => {
      const idx = prev.findIndex(x => x.menu_code === menuCode && x.tab_key === tabKey);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], [field]: value };
        if (field === "can_view" && !value) {
          next[idx] = { ...next[idx], can_create: false, can_edit: false, can_delete: false, can_export: false, can_import: false };
        }
        return next;
      }
      const base: TabPermRow = { role_id: selectedRole, menu_code: menuCode, tab_key: tabKey, can_view: false, can_create: false, can_edit: false, can_delete: false, can_export: false, can_import: false };
      return [...prev, { ...base, [field]: value }];
    });
  };

  const getDivAccess = (division: string): DivAccessRow => {
    const r = divAccess.find(x => x.division === division);
    return r || { role_id: selectedRole, division, can_view: false, can_create: false, can_edit: false, can_delete: false, can_export: false, can_import: false };
  };
  const setDivAccessField = (division: string, field: keyof DivAccessRow, value: boolean) => {
    setDivAccess(prev => {
      const idx = prev.findIndex(x => x.division === division);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], [field]: value };
        if (field === "can_view" && !value) {
          next[idx] = { ...next[idx], can_create: false, can_edit: false, can_delete: false, can_export: false, can_import: false };
        }
        return next;
      }
      const base: DivAccessRow = { role_id: selectedRole, division, can_view: false, can_create: false, can_edit: false, can_delete: false, can_export: false, can_import: false };
      return [...prev, { ...base, [field]: value }];
    });
  };
  const toggleAllDivisions = (field: keyof DivAccessRow, value: boolean) => {
    const visible = (divSearch.trim() ? allDivisions.filter(d => d.toLowerCase().includes(divSearch.toLowerCase())) : allDivisions);
    setDivAccess(prev => {
      const map = new Map(prev.map(r => [r.division, r]));
      for (const d of visible) {
        const cur = map.get(d) || { role_id: selectedRole, division: d, can_view: false, can_create: false, can_edit: false, can_delete: false, can_export: false, can_import: false };
        const next = { ...cur, [field]: value } as DivAccessRow;
        if (field === "can_view" && !value) {
          next.can_create = false; next.can_edit = false; next.can_delete = false; next.can_export = false; next.can_import = false;
        }
        map.set(d, next);
      }
      return Array.from(map.values());
    });
  };

  const saveRolePerms = async () => {
    if (!selectedRole) return;
    setSavingRole(true);
    try {
      await supabase.from("role_menu_permissions").delete().eq("role_id", selectedRole);
      const rmpInsert = rmpRows
        .filter(r => r.can_view || r.can_create || r.can_edit || r.can_delete || r.can_export || r.can_import)
        .map(r => ({ role_id: selectedRole, menu_id: r.menu_id, can_view: r.can_view, can_create: r.can_create, can_edit: r.can_edit, can_delete: r.can_delete, can_export: r.can_export, can_import: r.can_import }));
      if (rmpInsert.length) await (supabase as any).from("role_menu_permissions").insert(rmpInsert);

      await (supabase as any).from("column_permissions").delete().eq("role_id", selectedRole);
      const cpInsert = colPerms
        .filter(c => c.access !== "write")
        .map(c => ({ role_id: selectedRole, menu_code: c.menu_code, column_key: c.column_key, access: c.access }));
      if (cpInsert.length) await (supabase as any).from("column_permissions").insert(cpInsert);

      await (supabase as any).from("tab_permissions").delete().eq("role_id", selectedRole);
      const tpInsert = tabPerms
        .filter(t => t.can_view || t.can_create || t.can_edit || t.can_delete || t.can_export || t.can_import)
        .map(t => ({ role_id: selectedRole, menu_code: t.menu_code, tab_key: t.tab_key, can_view: t.can_view, can_create: t.can_create, can_edit: t.can_edit, can_delete: t.can_delete, can_export: t.can_export, can_import: t.can_import }));
      if (tpInsert.length) await (supabase as any).from("tab_permissions").insert(tpInsert);

      await (supabase as any).from("role_division_access").delete().eq("role_id", selectedRole);
      const daInsert = divAccess
        .filter(d => d.can_view || d.can_create || d.can_edit || d.can_delete || d.can_export || d.can_import)
        .map(d => ({ role_id: selectedRole, division: d.division, can_view: d.can_view, can_create: d.can_create, can_edit: d.can_edit, can_delete: d.can_delete, can_export: d.can_export, can_import: d.can_import }));
      if (daInsert.length) await (supabase as any).from("role_division_access").insert(daInsert);

      toast({ title: "บันทึกสิทธิ์เรียบร้อย" });
      await refreshPermissions();
      loadRolePerms(selectedRole);
    } catch (e: any) {
      toast({ title: "เกิดข้อผิดพลาด", description: e.message, variant: "destructive" });
    } finally { setSavingRole(false); }
  };

  const createRole = async () => {
    if (!newRoleName.trim()) return;
    try {
      const { data, error } = await supabase.from("roles").insert({ role_name: newRoleName.trim() }).select().single();
      if (error) throw error;
      toast({ title: "สร้าง Role สำเร็จ" });
      setNewRoleName(""); setShowNewRole(false);
      const { data: rolesList } = await supabase.from("roles").select("*").order("role_name");
      setRoles((rolesList || []) as RoleOption[]);
      if (data) setSelectedRole(data.id);
    } catch (e: any) {
      toast({ title: "เกิดข้อผิดพลาด", description: e.message, variant: "destructive" });
    }
  };

  const deleteRole = async (roleId: string) => {
    if (!confirm("ลบ Role นี้? ผู้ใช้ที่ผูก Role นี้จะไม่มีสิทธิ์เข้าใช้งาน")) return;
    try {
      await supabase.from("roles").delete().eq("id", roleId);
      toast({ title: "ลบแล้ว" });
      const { data } = await supabase.from("roles").select("*").order("role_name");
      setRoles((data || []) as RoleOption[]);
      if (selectedRole === roleId) setSelectedRole("");
      loadUsers();
    } catch (e: any) {
      toast({ title: "เกิดข้อผิดพลาด", description: e.message, variant: "destructive" });
    }
  };

  // Group menus: Main → its Subs (and orphan Subs by themselves).
  const menuGroups = useMemo(() => {
    const mains = menus.filter(m => !m.parent_id).sort((a, b) => a.sort_order - b.sort_order);
    const subsByParent = new Map<string, MenuRow[]>();
    for (const m of menus) {
      if (m.parent_id) {
        const arr = subsByParent.get(m.parent_id) || [];
        arr.push(m);
        subsByParent.set(m.parent_id, arr);
      }
    }
    for (const arr of subsByParent.values()) arr.sort((a, b) => a.sort_order - b.sort_order);
    const groups = mains.map(main => ({
      main,
      subs: subsByParent.get(main.id) || [],
    }));
    const mainIds = new Set(mains.map(m => m.id));
    const orphans = menus.filter(m => m.parent_id && !mainIds.has(m.parent_id));
    if (orphans.length) groups.push({ main: { id: "_orphan", menu_code: "other", menu_name: "Other", menu_type: "Main", parent_id: null, sort_order: 999 } as MenuRow, subs: orphans });
    return groups;
  }, [menus]);

  if (!isAdmin) return <div className="p-8 text-center text-muted-foreground">ไม่มีสิทธิ์เข้าถึง</div>;

  const filtered = users.filter(u => {
    const matchSearch = !search || u.full_name.toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase());
    if (!matchSearch) return false;
    const isPending = !u.is_active || !u.role_id;
    if (showActiveOnly && (!u.is_active || isPending)) return false;
    if (showPendingOnly && !isPending) return false;
    return true;
  });

  const roleBadgeColor: Record<string, string> = {
    Admin: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
    Manager: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
    Buyer: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
    Viewer: "bg-gray-100 text-gray-700 dark:bg-gray-800/50 dark:text-gray-400",
  };

  const pendingCount = users.filter(u => !u.is_active || !u.role_id).length;


  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between p-4 border-b">
        <div className="flex items-center gap-2">
          <Shield className="w-5 h-5 text-primary" />
          <h1 className="text-lg font-bold">User & Role Management</h1>
          <span className="text-xs text-muted-foreground">{users.length} users</span>
          {pendingCount > 0 && (
            <Badge variant="outline" className="text-amber-600 border-amber-300">
              รออนุมัติ {pendingCount}
            </Badge>
          )}
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="flex-1 flex flex-col overflow-hidden">
        <TabsList className="mx-4 mt-3 self-start">
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="roles">Roles & Permissions</TabsTrigger>
        </TabsList>

        {/* USERS TAB */}
        <TabsContent value="users" className="flex-1 overflow-auto p-4 m-0">
          <div className="flex justify-between items-center mb-3 gap-3 flex-wrap">
            <div className="relative w-72">
              <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" />
              <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="ค้นหาชื่อ / Email" className="pl-9 h-9" />
            </div>
            <div className="flex items-center gap-4 text-xs">
              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox checked={showActiveOnly} onCheckedChange={(c) => { setShowActiveOnly(!!c); if (c) setShowPendingOnly(false); }} />
                Show เฉพาะ Active
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox checked={showPendingOnly} onCheckedChange={(c) => { setShowPendingOnly(!!c); if (c) setShowActiveOnly(false); }} />
                Show เฉพาะรออนุมัติ
              </label>
            </div>
          </div>

          {loading ? (
            <div className="text-center py-12 text-muted-foreground">กำลังโหลด...</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ชื่อ</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>แผนก</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>SPC</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead>สถานะ</TableHead>
                  <TableHead className="w-[160px]">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(u => {
                  const isPending = !u.is_active || !u.role_id;
                  return (
                    <TableRow key={u.user_id} className={isPending ? "bg-amber-50/50 dark:bg-amber-950/20" : ""}>
                      <TableCell className="font-medium">{u.full_name || "—"}</TableCell>
                      <TableCell className="text-xs">{u.email}</TableCell>
                      <TableCell className="text-xs">{u.phone || "—"}</TableCell>
                      <TableCell className="text-xs">{u.department || "—"}</TableCell>
                      <TableCell>
                        <Badge variant="secondary" className={roleBadgeColor[u.role_name] || ""}>{u.role_name}</Badge>
                      </TableCell>
                      <TableCell className="text-xs">{u.spc_name || "-"}</TableCell>
                      <TableCell className="text-xs">{u.vendor_code || "-"}</TableCell>
                      <TableCell>
                        <Badge variant={u.is_active ? "default" : "outline"}>{u.is_active ? "Active" : "Inactive"}</Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          {isPending && roles.length > 0 && (
                            <Select onValueChange={(v) => quickApprove(u, v)}>
                              <SelectTrigger className="h-7 text-[11px] w-28">
                                <CheckCircle2 className="w-3 h-3 mr-1 text-green-600" />
                                <SelectValue placeholder="Approve" />
                              </SelectTrigger>
                              <SelectContent>
                                {roles.map(r => <SelectItem key={r.id} value={r.id}>{r.role_name}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          )}
                          <Button size="icon" variant="ghost" onClick={() => openEdit(u)}>
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </TabsContent>

        {/* ROLES TAB */}
        <TabsContent value="roles" className="flex-1 overflow-auto p-4 m-0 space-y-4">
          <div className="flex items-center gap-2 flex-wrap">
            <Label className="text-xs">เลือก Role:</Label>
            <Select value={selectedRole} onValueChange={setSelectedRole}>
              <SelectTrigger className="w-56 h-8"><SelectValue placeholder="-- เลือก --" /></SelectTrigger>
              <SelectContent>
                {roles.map(r => <SelectItem key={r.id} value={r.id}>{r.role_name}</SelectItem>)}
              </SelectContent>
            </Select>
            {selectedRole && roles.find(r => r.id === selectedRole)?.role_name !== "Admin" && (
              <Button size="sm" variant="outline" className="h-8 text-xs text-red-600" onClick={() => deleteRole(selectedRole)}>
                <Trash2 className="w-3.5 h-3.5 mr-1" /> ลบ Role
              </Button>
            )}
            <div className="flex-1" />
            {showNewRole ? (
              <>
                <Input value={newRoleName} onChange={e => setNewRoleName(e.target.value)} placeholder="ชื่อ Role ใหม่" className="h-8 w-44" />
                <Button size="sm" className="h-8" onClick={createRole}>สร้าง</Button>
                <Button size="sm" variant="ghost" className="h-8" onClick={() => { setShowNewRole(false); setNewRoleName(""); }}>ยกเลิก</Button>
              </>
            ) : (
              <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setShowNewRole(true)}>
                <Plus className="w-3.5 h-3.5 mr-1" /> เพิ่ม Role
              </Button>
            )}
          </div>

          {selectedRole ? (
            <>
              <div className="border rounded-lg overflow-hidden">
                <div className="px-3 py-2 bg-muted text-xs font-semibold border-b flex items-center justify-between">
                  <span>เมนู &amp; สิทธิ์ CRUD (จัดกลุ่มตาม Main → Sub)</span>
                  <span className="text-[10px] font-normal text-muted-foreground">ติก View ที่เมนูใด ระบบจะแสดงสิทธิ์ระดับคอลัมน์ของเมนูนั้นด้านล่าง</span>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>เมนู</TableHead>
                      <TableHead className="text-center w-16">View</TableHead>
                      <TableHead className="text-center w-16">Create</TableHead>
                      <TableHead className="text-center w-16">Edit</TableHead>
                      <TableHead className="text-center w-16">Delete</TableHead>
                      <TableHead className="text-center w-16">Export</TableHead>
                      <TableHead className="text-center w-16">Import</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {menuGroups.map(({ main, subs }) => (
                      <Fragment key={main.id}>
                        {main.id !== "_orphan" && (() => {
                          const r = getRmp(main.id);
                          return (
                            <TableRow key={main.id} className="bg-muted/40">
                              <TableCell className="text-xs">
                                <div className="font-bold text-primary">{main.menu_name}</div>
                                <div className="text-[10px] text-muted-foreground">{main.menu_code} · Main</div>
                              </TableCell>
                              {(["can_view","can_create","can_edit","can_delete","can_export","can_import"] as const).map(f => (
                                <TableCell key={f} className="text-center">
                                  <Checkbox
                                    checked={(r as any)[f]}
                                    disabled={f !== "can_view" && !r.can_view}
                                    onCheckedChange={(c) => setRmpField(main.id, f, !!c)}
                                  />
                                </TableCell>
                              ))}
                            </TableRow>
                          );
                        })()}
                        {subs.map(s => {
                          const r = getRmp(s.id);
                          return (
                            <TableRow key={s.id}>
                              <TableCell className="text-xs">
                                <div className="font-medium pl-5 border-l-2 border-primary/20 ml-1">↳ {s.menu_name}</div>
                                <div className="text-[10px] text-muted-foreground pl-6">{s.menu_code}</div>
                              </TableCell>
                              {(["can_view","can_create","can_edit","can_delete","can_export","can_import"] as const).map(f => (
                                <TableCell key={f} className="text-center">
                                  <Checkbox
                                    checked={(r as any)[f]}
                                    disabled={f !== "can_view" && !r.can_view}
                                    onCheckedChange={(c) => setRmpField(s.id, f, !!c)}
                                  />
                                </TableCell>
                              ))}
                            </TableRow>
                          );
                        })}
                      </Fragment>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Column-level permissions: only show menus where View is ticked AND COLUMN_DEFS exists */}
              {(() => {
                const visibleMenus = menus.filter(m => {
                  if (!COLUMN_DEFS[m.menu_code]) return false;
                  const r = rmpRows.find(x => x.menu_id === m.id);
                  return !!r?.can_view;
                });
                if (visibleMenus.length === 0) {
                  return (
                    <div className="border rounded-lg p-4 text-center text-xs text-muted-foreground bg-muted/20">
                      ติก <strong>View</strong> ที่เมนูที่มีสิทธิ์ระดับคอลัมน์ (เช่น SRR DC ITEM, SRR DIRECT ITEM, Special Order, Data Control) เพื่อปรับสิทธิ์รายคอลัมน์
                    </div>
                  );
                }
                return (
                  <div className="border rounded-lg overflow-hidden">
                    <div className="px-3 py-2 bg-muted text-xs font-semibold border-b">
                      สิทธิ์ระดับคอลัมน์ <span className="font-normal text-muted-foreground">(hidden = ซ่อน, read = ดูอย่างเดียว, write = แก้ได้)</span>
                    </div>
                    <div className="p-3 space-y-4">
                      {visibleMenus.map(m => {
                        const def = COLUMN_DEFS[m.menu_code];
                        return (
                          <div key={m.menu_code} className="space-y-1.5">
                            <div className="text-xs font-semibold text-primary">{def.label} <span className="text-muted-foreground">({m.menu_code})</span></div>
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                              {def.columns.map(c => (
                                <div key={c.key} className="flex items-center gap-2 border rounded px-2 py-1.5">
                                  <span className="text-xs flex-1 truncate">{c.label}</span>
                                  <Select value={getColAccess(m.menu_code, c.key)} onValueChange={(v: any) => setColAccess(m.menu_code, c.key, v)}>
                                    <SelectTrigger className="h-7 w-24 text-[11px]"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="write">Write</SelectItem>
                                      <SelectItem value="read">Read</SelectItem>
                                      <SelectItem value="hidden">Hidden</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

              {/* Tab-level permissions: only show menus where View is ticked AND TAB_DEFS exists */}
              {(() => {
                const visibleTabMenus = menus.filter(m => {
                  if (!TAB_DEFS[m.menu_code]) return false;
                  const r = rmpRows.find(x => x.menu_id === m.id);
                  return !!r?.can_view;
                });
                if (visibleTabMenus.length === 0) return null;
                return (
                  <div className="border rounded-lg overflow-hidden">
                    <div className="px-3 py-2 bg-muted text-xs font-semibold border-b">
                      สิทธิ์ระดับ Tab <span className="font-normal text-muted-foreground">(View / Create / Edit / Delete / Export / Import ของแต่ละ Tab)</span>
                    </div>
                    <div className="p-3 space-y-4">
                      {visibleTabMenus.map(m => {
                        const def = TAB_DEFS[m.menu_code];
                        return (
                          <div key={m.menu_code} className="space-y-1.5">
                            <div className="text-xs font-semibold text-primary">{def.label} <span className="text-muted-foreground">({m.menu_code})</span></div>
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead className="text-xs">Tab</TableHead>
                                  <TableHead className="text-center w-14 text-xs">View</TableHead>
                                  <TableHead className="text-center w-14 text-xs">Create</TableHead>
                                  <TableHead className="text-center w-14 text-xs">Edit</TableHead>
                                  <TableHead className="text-center w-14 text-xs">Delete</TableHead>
                                  <TableHead className="text-center w-14 text-xs">Export</TableHead>
                                  <TableHead className="text-center w-14 text-xs">Import</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {def.tabs.map(t => {
                                  const tp = getTabPerm(m.menu_code, t.key);
                                  return (
                                    <TableRow key={t.key}>
                                      <TableCell className="text-xs">{t.label} <span className="text-[10px] text-muted-foreground">({t.key})</span></TableCell>
                                      {(["can_view","can_create","can_edit","can_delete","can_export","can_import"] as const).map(f => (
                                        <TableCell key={f} className="text-center">
                                          <Checkbox
                                            checked={(tp as any)[f]}
                                            disabled={f !== "can_view" && !tp.can_view}
                                            onCheckedChange={(c) => setTabPermField(m.menu_code, t.key, f, !!c)}
                                          />
                                        </TableCell>
                                      ))}
                                    </TableRow>
                                  );
                                })}
                              </TableBody>
                            </Table>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

              {/* Division-level access (applies to Data Master & PO Cost) */}
              {(() => {
                const visible = divSearch.trim()
                  ? allDivisions.filter(d => d.toLowerCase().includes(divSearch.toLowerCase()))
                  : allDivisions;
                const fields: { key: keyof DivAccessRow; label: string }[] = [
                  { key: "can_view", label: "View" },
                  { key: "can_create", label: "Insert" },
                  { key: "can_edit", label: "Update" },
                  { key: "can_delete", label: "Delete" },
                  { key: "can_import", label: "Import" },
                  { key: "can_export", label: "Export" },
                ];
                return (
                  <div className="border rounded-lg overflow-hidden">
                    <div className="px-3 py-2 bg-muted text-xs font-semibold border-b flex items-center justify-between gap-2 flex-wrap">
                      <span>สิทธิ์ระดับ Division <span className="font-normal text-muted-foreground">(บังคับใช้กับ Data Master &amp; PO Cost — เลือกว่า Role นี้เข้าถึง Division ใดได้บ้าง)</span></span>
                      <span className="text-[10px] font-normal text-muted-foreground">ถ้าไม่ติกเลย = เห็นได้ทุก Division</span>
                    </div>
                    <div className="p-3 space-y-2">
                      <div className="flex items-center gap-2">
                        <Input
                          value={divSearch}
                          onChange={e => setDivSearch(e.target.value)}
                          placeholder={`ค้นหา Division... (${allDivisions.length} รายการ)`}
                          className="h-8 w-64 text-xs"
                        />
                        <span className="text-[10px] text-muted-foreground">แสดง {visible.length} รายการ</span>
                      </div>
                      <div className="max-h-[420px] overflow-auto border rounded">
                        <Table>
                          <TableHeader className="sticky top-0 bg-muted z-10">
                            <TableRow>
                              <TableHead className="text-xs">Division</TableHead>
                              {fields.map(f => (
                                <TableHead key={f.key} className="text-center w-20 text-xs">
                                  <div>{f.label}</div>
                                  <div className="flex justify-center gap-1 mt-0.5">
                                    <button type="button" className="text-[9px] text-primary hover:underline" onClick={() => toggleAllDivisions(f.key, true)}>all</button>
                                    <span className="text-[9px] text-muted-foreground">|</span>
                                    <button type="button" className="text-[9px] text-muted-foreground hover:underline" onClick={() => toggleAllDivisions(f.key, false)}>none</button>
                                  </div>
                                </TableHead>
                              ))}
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {visible.length === 0 ? (
                              <TableRow><TableCell colSpan={fields.length + 1} className="text-center text-xs text-muted-foreground py-4">ไม่พบ Division</TableCell></TableRow>
                            ) : visible.map(d => {
                              const r = getDivAccess(d);
                              return (
                                <TableRow key={d}>
                                  <TableCell className="text-xs font-medium">{d}</TableCell>
                                  {fields.map(f => (
                                    <TableCell key={f.key} className="text-center">
                                      <Checkbox
                                        checked={(r as any)[f.key]}
                                        disabled={f.key !== "can_view" && !r.can_view}
                                        onCheckedChange={c => setDivAccessField(d, f.key, !!c)}
                                      />
                                    </TableCell>
                                  ))}
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                  </div>
                );
              })()}

              <div className="flex justify-end">
                <Button onClick={saveRolePerms} disabled={savingRole}>
                  <Save className="w-4 h-4 mr-1.5" />
                  {savingRole ? "กำลังบันทึก..." : "บันทึกสิทธิ์"}
                </Button>
              </div>
            </>
          ) : (
            <div className="text-center py-12 text-muted-foreground text-sm">เลือก Role เพื่อกำหนดสิทธิ์</div>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={!!editUser} onOpenChange={() => setEditUser(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>แก้ไขผู้ใช้: {editUser?.full_name || editUser?.email}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2 max-h-[70vh] overflow-y-auto pr-1">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">ชื่อ-นามสกุล</Label>
                <Input value={editFullName} onChange={e => setEditFullName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Email</Label>
                <Input type="email" value={editEmail} onChange={e => setEditEmail(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Phone</Label>
                <Input value={editPhone} onChange={e => setEditPhone(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">แผนก</Label>
                <Input value={editDepartment} onChange={e => setEditDepartment(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Password ใหม่ <span className="text-muted-foreground">(ว่างไว้ = ไม่เปลี่ยน, ขั้นต่ำ 6 ตัว)</span></Label>
              <Input type="text" value={editPassword} onChange={e => setEditPassword(e.target.value)} placeholder="••••••" autoComplete="new-password" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Role</Label>
              <Select value={editRole} onValueChange={setEditRole}>
                <SelectTrigger><SelectValue placeholder="-- เลือก Role --" /></SelectTrigger>
                <SelectContent>
                  {roles.map(r => <SelectItem key={r.id} value={r.id}>{r.role_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">SPC Name (จำกัดข้อมูล)</Label>
                <Input value={editSpc} onChange={e => setEditSpc(e.target.value)} placeholder="ว่างไว้ = เห็นทุก SPC" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Vendor Code (จำกัดข้อมูล)</Label>
                <Input value={editVendor} onChange={e => setEditVendor(e.target.value)} placeholder="ว่างไว้ = เห็นทุก Vendor" />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Label className="text-xs">Active</Label>
              <Switch checked={editActive} onCheckedChange={setEditActive} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditUser(null)}>ยกเลิก</Button>
            <Button onClick={saveUser} disabled={saving}>{saving ? "กำลังบันทึก..." : "บันทึก"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
