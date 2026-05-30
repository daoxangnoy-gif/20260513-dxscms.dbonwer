import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User, Session } from "@supabase/supabase-js";

export type CrudAction = "view" | "create" | "edit" | "delete" | "export" | "import";
export type ColumnAccess = "hidden" | "read" | "write";

export interface MenuCrud {
  view?: boolean;
  create?: boolean;
  edit?: boolean;
  delete?: boolean;
  export?: boolean;
  import?: boolean;
}

export interface DivisionPerm {
  view: boolean; create: boolean; edit: boolean; delete: boolean; import: boolean; export: boolean;
}

export interface UserPermissions {
  role_name: string | null;
  role_id: string | null;
  permissions: string[];
  visible_menus: string[];
  menu_crud: Record<string, MenuCrud>;
  column_perms: Record<string, ColumnAccess>; // key = "menu_code::column_key"
  division_perms: Record<string, DivisionPerm>; // key = division name; empty record = no restriction
  spc_name: string | null;
  vendor_code: string | null;
  is_active: boolean;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  userPermissions: UserPermissions | null;
  hasPermission: (perm: string) => boolean;
  canViewMenu: (menuCode: string) => boolean;
  canDo: (menuCode: string, action: CrudAction) => boolean;
  getColAccess: (menuCode: string, columnKey: string) => ColumnAccess;
  divisionAllowed: (division: string | null | undefined, action: CrudAction) => boolean;
  anyDivisionAllowed: (action: CrudAction) => boolean;
  allowedDivisions: () => Set<string> | null;
  isAdmin: boolean;
  signOut: () => Promise<void>;
  refreshPermissions: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [userPermissions, setUserPermissions] = useState<UserPermissions | null>(null);

  const fetchPermissions = useCallback(async (userId: string) => {
    try {
      const { data, error } = await supabase.rpc("get_user_permissions", { _user_id: userId });
      // Fetch user's role id + division access in parallel
      const { data: urData } = await supabase
        .from("user_roles")
        .select("role_id")
        .eq("user_id", userId)
        .maybeSingle();
      const roleId = (urData as any)?.role_id || null;
      let divisionPerms: Record<string, DivisionPerm> = {};
      if (roleId) {
        const { data: rdaData } = await (supabase as any)
          .from("role_division_access")
          .select("division, can_view, can_create, can_edit, can_delete, can_import, can_export")
          .eq("role_id", roleId);
        for (const r of (rdaData || []) as any[]) {
          divisionPerms[r.division] = {
            view: !!r.can_view, create: !!r.can_create, edit: !!r.can_edit,
            delete: !!r.can_delete, import: !!r.can_import, export: !!r.can_export,
          };
        }
      }
      if (!error && data && data.length > 0) {
        const row = data[0] as any;
        setUserPermissions({
          role_name: row.role_name || null,
          role_id: roleId,
          permissions: row.permissions || [],
          visible_menus: row.visible_menus || [],
          menu_crud: (row.menu_crud as Record<string, MenuCrud>) || {},
          column_perms: (row.column_perms as Record<string, ColumnAccess>) || {},
          division_perms: divisionPerms,
          spc_name: row.spc_name || null,
          vendor_code: row.vendor_code || null,
          is_active: row.is_active === true,
        });
      } else {
        setUserPermissions({
          role_name: null, role_id: roleId, permissions: [], visible_menus: [],
          menu_crud: {}, column_perms: {}, division_perms: divisionPerms,
          spc_name: null, vendor_code: null, is_active: false,
        });
      }
    } catch (e) {
      console.error("Failed to fetch permissions", e);
    }
  }, []);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, sess) => {
      setSession(sess);
      setUser(sess?.user ?? null);
      if (sess?.user) {
        setTimeout(() => fetchPermissions(sess.user.id), 0);
      } else {
        setUserPermissions(null);
      }
      setLoading(false);
    });

    supabase.auth.getSession().then(({ data: { session: sess } }) => {
      setSession(sess);
      setUser(sess?.user ?? null);
      if (sess?.user) fetchPermissions(sess.user.id);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, [fetchPermissions]);

  const hasPermission = useCallback((perm: string) => {
    return userPermissions?.permissions?.includes(perm) ?? false;
  }, [userPermissions]);

  const canViewMenu = useCallback((menuCode: string) => {
    return userPermissions?.visible_menus?.includes(menuCode) ?? false;
  }, [userPermissions]);

  const isAdmin = userPermissions?.role_name === "Admin";

  const canDo = useCallback((menuCode: string, action: CrudAction) => {
    if (isAdmin) return true;
    const m = userPermissions?.menu_crud?.[menuCode];
    if (!m) return false;
    return m[action] === true;
  }, [userPermissions, isAdmin]);

  const getColAccess = useCallback((menuCode: string, columnKey: string): ColumnAccess => {
    if (isAdmin) return "write";
    const v = userPermissions?.column_perms?.[`${menuCode}::${columnKey}`];
    return v ?? "write"; // default = write when no rule set
  }, [userPermissions, isAdmin]);

  /** Returns true if the row's division allows the action. Empty division map = no restriction. */
  const divisionAllowed = useCallback((division: string | null | undefined, action: CrudAction) => {
    if (isAdmin) return true;
    const map = userPermissions?.division_perms || {};
    if (Object.keys(map).length === 0) return true;
    if (!division) return false;
    const p = map[division];
    return !!p && p[action] === true;
  }, [userPermissions, isAdmin]);

  /** Returns true if at least one configured division allows the action. */
  const anyDivisionAllowed = useCallback((action: CrudAction) => {
    if (isAdmin) return true;
    const map = userPermissions?.division_perms || {};
    if (Object.keys(map).length === 0) return true;
    return Object.values(map).some(p => p[action] === true);
  }, [userPermissions, isAdmin]);

  /** Set of divisions with view permission; null = no restriction. */
  const allowedDivisions = useCallback((): Set<string> | null => {
    if (isAdmin) return null;
    const map = userPermissions?.division_perms || {};
    if (Object.keys(map).length === 0) return null;
    return new Set(Object.entries(map).filter(([, p]) => p.view).map(([d]) => d));
  }, [userPermissions, isAdmin]);

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
    setUserPermissions(null);
  };

  const refreshPermissions = async () => {
    if (user) await fetchPermissions(user.id);
  };

  return (
    <AuthContext.Provider value={{
      user, session, loading, userPermissions,
      hasPermission, canViewMenu, canDo, getColAccess,
      divisionAllowed, anyDivisionAllowed, allowedDivisions,
      isAdmin, signOut, refreshPermissions,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
