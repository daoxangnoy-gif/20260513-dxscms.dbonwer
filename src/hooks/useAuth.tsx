import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User, Session } from "@supabase/supabase-js";

export type CrudAction = "view" | "create" | "edit" | "delete" | "export";
export type ColumnAccess = "hidden" | "read" | "write";

export interface MenuCrud {
  view?: boolean;
  create?: boolean;
  edit?: boolean;
  delete?: boolean;
  export?: boolean;
}

export interface UserPermissions {
  role_name: string | null;
  permissions: string[];
  visible_menus: string[];
  menu_crud: Record<string, MenuCrud>;
  column_perms: Record<string, ColumnAccess>; // key = "menu_code::column_key"
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
      if (!error && data && data.length > 0) {
        const row = data[0] as any;
        setUserPermissions({
          role_name: row.role_name || null,
          permissions: row.permissions || [],
          visible_menus: row.visible_menus || [],
          menu_crud: (row.menu_crud as Record<string, MenuCrud>) || {},
          column_perms: (row.column_perms as Record<string, ColumnAccess>) || {},
          spc_name: row.spc_name || null,
          vendor_code: row.vendor_code || null,
          is_active: row.is_active === true,
        });
      } else {
        // No row returned - user has neither role nor profile yet
        setUserPermissions({
          role_name: null, permissions: [], visible_menus: [],
          menu_crud: {}, column_perms: {},
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
      hasPermission, canViewMenu, canDo, getColAccess, isAdmin, signOut, refreshPermissions,
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
