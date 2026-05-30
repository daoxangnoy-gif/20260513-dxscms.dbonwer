import { useState, useEffect } from "react";
import {
  Database, BarChart3, Package, ArrowUpDown, DollarSign,
  ShoppingCart, TrendingUp, Calendar, Truck,
  ChevronRight, ChevronDown, ChevronLeft, Users, FileText, History, Store,
  LogOut, Shield, Settings2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { DATA_TABLES, SRR_SUB_MENUS, AllTableName, REPORT_SUB_MENUS } from "@/lib/tableConfig";
import { supabase } from "@/integrations/supabase/client";
import appLogo from "@/assets/dx-scm-logo.png";
import { useAuth } from "@/hooks/useAuth";

const ICONS: Record<string, React.ElementType> = {
  data_master: Database, stock: Package, minmax: ArrowUpDown,
  po_cost: DollarSign, on_order: ShoppingCart, rank_sales: TrendingUp,
  sales_by_week: Calendar, vendor_master: Truck, range_store: Store, store_type: Store,
  customers: Users,
};

export type MainPage = "data_control" | "srr" | "user_control" | "report" | "log" | "config";

interface AppSidebarProps {
  currentPage: MainPage;
  setCurrentPage: (page: MainPage) => void;
  activeTable: AllTableName;
  setActiveTable: (t: AllTableName) => void;
  activeSrrSub: string;
  setActiveSrrSub: (s: string) => void;
  activeLogSub: string;
  setActiveLogSub: (s: string) => void;
  activeReportSub: string;
  setActiveReportSub: (s: string) => void;
  activeConfigSub: string;
  setActiveConfigSub: (s: string) => void;
}

export const LOG_SUB_MENUS: { key: string; label: string; menuCode: string }[] = [
  { key: "log_po_cost", label: "Log - PO Cost", menuCode: "log_po_cost" },
];

export const CONFIG_SUB_MENUS: { key: string; label: string; menuCode: string }[] = [
  { key: "config_column_export", label: "Config - Column Export", menuCode: "config" },
  { key: "config_filter", label: "Config - Filter", menuCode: "config" },
];

function formatCount(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(0)}K`;
  return String(n);
}

// Map MainPage to menu_code
const PAGE_TO_MENU: Record<MainPage, string> = {
  data_control: "data_control",
  srr: "srr",
  user_control: "admin",
  report: "report",
  log: "log",
  config: "config",
};

export default function AppSidebar({ currentPage, setCurrentPage, activeTable, setActiveTable, activeSrrSub, setActiveSrrSub, activeLogSub, setActiveLogSub, activeReportSub, setActiveReportSub, activeConfigSub, setActiveConfigSub }: AppSidebarProps) {
  const { canViewMenu, userPermissions, signOut, isAdmin } = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  const [dataExpanded, setDataExpanded] = useState(true);
  const [srrExpanded, setSrrExpanded] = useState(false);
  const [logExpanded, setLogExpanded] = useState(false);
  const [reportExpanded, setReportExpanded] = useState(false);
  const [configExpanded, setConfigExpanded] = useState(false);

  // Click main menu → set current page AND collapse other expandable groups (accordion)
  const handleMainClick = (key: MainPage) => {
    setCurrentPage(key);
    setDataExpanded(key === "data_control");
    setSrrExpanded(key === "srr");
    setLogExpanded(key === "log");
    setReportExpanded(key === "report");
    setConfigExpanded(key === "config");
  };
  const [counts, setCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    if (currentPage !== "data_control") return;
    const loadCounts = async () => {
      const results: Record<string, number> = {};
      for (const t of DATA_TABLES) {
        if (t.name === "range_store") continue;
        const { count } = await supabase.from(t.name).select("*", { count: "exact", head: true });
        results[t.name] = count || 0;
      }
      setCounts(results);
    };
    loadCounts();
  }, [currentPage]);

  const allMenus: { key: MainPage; label: string; icon: React.ElementType; menuCode: string }[] = [
    { key: "data_control", label: "Data Control", icon: Database, menuCode: "data_control" },
    { key: "srr", label: "Supply Chain", icon: BarChart3, menuCode: "srr" },
    { key: "report", label: "Report", icon: FileText, menuCode: "report" },
    { key: "user_control", label: "Admin", icon: Shield, menuCode: "admin" },
    { key: "config", label: "Config", icon: Settings2, menuCode: "config" },
    { key: "log", label: "Log", icon: History, menuCode: "log" },
  ];

  // Admin sees all menus regardless of explicit grants
  const mainMenus = allMenus.filter(m => isAdmin || canViewMenu(m.menuCode));

  // Filter SRR sub-menus
  const visibleSrrSubs = SRR_SUB_MENUS.filter(s => isAdmin || canViewMenu(s.key));

  // Filter Data Control sub-menus by per-table permission (menu_code === table name)
  const visibleDataTables = DATA_TABLES.filter(t => isAdmin || canViewMenu(t.name));

  return (
    <aside className={cn(
      "flex flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border transition-all duration-200",
      collapsed ? "w-16" : "w-60"
    )}>
      <div className="flex items-center gap-2 px-3 h-14 border-b border-sidebar-border">
        <img src={appLogo} alt="DX SCMS" className="h-9 w-auto flex-shrink-0 rounded" />
        {!collapsed && <span className="font-bold text-sm text-sidebar-accent-foreground">DX SCMS</span>}
      </div>

      {/* User info */}
      {!collapsed && userPermissions && (
        <div className="px-4 py-2 border-b border-sidebar-border">
          <div className="text-xs font-medium text-sidebar-foreground truncate">{userPermissions.role_name}</div>
          {userPermissions.spc_name && (
            <div className="text-[10px] text-muted-foreground">SPC: {userPermissions.spc_name}</div>
          )}
        </div>
      )}

      <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-1">
        {mainMenus.map(menu => {
          const isActive = currentPage === menu.key;
          const hasSubMenu = menu.key === "data_control" || menu.key === "srr" || menu.key === "log" || menu.key === "report" || menu.key === "config";
          const isExpanded = menu.key === "data_control" ? dataExpanded : menu.key === "srr" ? srrExpanded : menu.key === "log" ? logExpanded : menu.key === "report" ? reportExpanded : menu.key === "config" ? configExpanded : false;

          return (
            <div key={menu.key}>
              <div className="flex items-center">
                <button
                  onClick={() => handleMainClick(menu.key)}
                  className={cn(
                    "flex-1 flex items-center gap-2 py-2 rounded-md text-sm font-semibold transition-all border-l-[3px]",
                    isActive
                      ? "bg-sidebar-accent text-sidebar-accent-foreground border-primary pl-2.5 pr-3"
                      : "text-sidebar-foreground hover:bg-sidebar-accent/50 border-transparent px-3"
                  )}
                >
                  <menu.icon className="w-4 h-4 flex-shrink-0" />
                  {!collapsed && menu.label}
                </button>
                {!collapsed && hasSubMenu && (
                  <button
                    onClick={() => {
                      if (menu.key === "data_control") setDataExpanded(!dataExpanded);
                      if (menu.key === "srr") setSrrExpanded(!srrExpanded);
                      if (menu.key === "log") setLogExpanded(!logExpanded);
                      if (menu.key === "report") setReportExpanded(!reportExpanded);
                      if (menu.key === "config") setConfigExpanded(!configExpanded);
                    }}
                    className="p-1 rounded hover:bg-sidebar-accent/50 text-sidebar-foreground/60 transition-colors"
                  >
                    <ChevronDown className={cn("w-3.5 h-3.5 transition-transform duration-200", isExpanded ? "rotate-0" : "-rotate-90")} />
                  </button>
                )}
              </div>

              {/* Data Control sub-menus */}
              {menu.key === "data_control" && !collapsed && dataExpanded && (
                <div className="ml-2 space-y-0.5">
                  {visibleDataTables.map((t) => {
                    const Icon = ICONS[t.name] || Database;
                    const count = counts[t.name] || 0;
                    return (
                      <button
                        key={t.name}
                        onClick={() => setActiveTable(t.name)}
                        className={cn(
                          "w-full flex items-center gap-2 py-1.5 rounded-md text-xs transition-all border-l-[2px]",
                          activeTable === t.name
                            ? "bg-sidebar-primary text-sidebar-primary-foreground border-primary/70 pl-2.5 pr-3"
                            : "text-sidebar-foreground hover:bg-sidebar-accent/50 border-transparent px-3"
                        )}
                      >
                        <ChevronRight className={cn("w-3 h-3 flex-shrink-0 transition-transform", activeTable === t.name && "rotate-90")} />
                        <Icon className="w-3.5 h-3.5 flex-shrink-0" />
                        <span className="flex-1 text-left">{t.label}</span>
                        {count > 0 && (
                          <span className={cn(
                            "text-[10px] px-1.5 py-0.5 rounded-full",
                            activeTable === t.name
                              ? "bg-sidebar-primary-foreground/20 text-sidebar-primary-foreground"
                              : "bg-sidebar-accent text-sidebar-foreground/70"
                          )}>
                            {formatCount(count)}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* SRR sub-menus */}
              {menu.key === "srr" && !collapsed && srrExpanded && (
                <div className="ml-2 space-y-0.5">
                  {visibleSrrSubs.map((sub) => (
                    <button
                      key={sub.key}
                      onClick={() => setActiveSrrSub(sub.key)}
                      className={cn(
                        "w-full flex items-center gap-2 py-1.5 rounded-md text-xs transition-all border-l-[2px]",
                        activeSrrSub === sub.key
                          ? "bg-sidebar-primary text-sidebar-primary-foreground border-primary/70 pl-2.5 pr-3"
                          : "text-sidebar-foreground hover:bg-sidebar-accent/50 border-transparent px-3"
                      )}
                    >
                      <ChevronRight className={cn("w-3 h-3 flex-shrink-0 transition-transform", activeSrrSub === sub.key && "rotate-90")} />
                      <BarChart3 className="w-3.5 h-3.5 flex-shrink-0" />
                      <span className="flex-1 text-left">{sub.label}</span>
                    </button>
                  ))}
                </div>
              )}

              {/* Admin sub-menus */}
              {menu.key === "user_control" && currentPage === "user_control" && !collapsed && (
                <div className="ml-2 space-y-0.5">
                  <button className={cn(
                    "w-full flex items-center gap-2 px-3 py-1.5 rounded-md text-xs",
                    "bg-sidebar-primary text-sidebar-primary-foreground"
                  )}>
                    <ChevronRight className="w-3 h-3 flex-shrink-0 rotate-90" />
                    <Users className="w-3.5 h-3.5 flex-shrink-0" />
                    <span className="flex-1 text-left">User Management</span>
                  </button>
                </div>
              )}

              {/* Log sub-menus */}
              {menu.key === "log" && !collapsed && logExpanded && (
                <div className="ml-2 space-y-0.5">
                  {LOG_SUB_MENUS.filter(s => isAdmin || canViewMenu(s.menuCode)).map((sub) => (
                    <button
                      key={sub.key}
                      onClick={() => setActiveLogSub(sub.key)}
                      className={cn(
                        "w-full flex items-center gap-2 py-1.5 rounded-md text-xs transition-all border-l-[2px]",
                        activeLogSub === sub.key
                          ? "bg-sidebar-primary text-sidebar-primary-foreground border-primary/70 pl-2.5 pr-3"
                          : "text-sidebar-foreground hover:bg-sidebar-accent/50 border-transparent px-3"
                      )}
                    >
                      <ChevronRight className={cn("w-3 h-3 flex-shrink-0 transition-transform", activeLogSub === sub.key && "rotate-90")} />
                      <History className="w-3.5 h-3.5 flex-shrink-0" />
                      <span className="flex-1 text-left">{sub.label}</span>
                    </button>
                  ))}
                </div>
              )}
              {/* Report sub-menus */}
              {menu.key === "report" && !collapsed && reportExpanded && (
                <div className="ml-2 space-y-0.5">
                  {REPORT_SUB_MENUS.filter(s => isAdmin || canViewMenu(s.menuCode)).map((sub) => (
                    <button
                      key={sub.key}
                      onClick={() => setActiveReportSub(sub.key)}
                      className={cn(
                        "w-full flex items-center gap-2 py-1.5 rounded-md text-xs transition-all border-l-[2px]",
                        activeReportSub === sub.key
                          ? "bg-sidebar-primary text-sidebar-primary-foreground border-primary/70 pl-2.5 pr-3"
                          : "text-sidebar-foreground hover:bg-sidebar-accent/50 border-transparent px-3"
                      )}
                    >
                      <ChevronRight className={cn("w-3 h-3 flex-shrink-0 transition-transform", activeReportSub === sub.key && "rotate-90")} />
                      <FileText className="w-3.5 h-3.5 flex-shrink-0" />
                      <span className="flex-1 text-left">{sub.label}</span>
                    </button>
                  ))}
                </div>
              )}
              {/* Config sub-menus */}
              {menu.key === "config" && !collapsed && configExpanded && (
                <div className="ml-2 space-y-0.5">
                  {CONFIG_SUB_MENUS.map((sub) => (
                    <button
                      key={sub.key}
                      onClick={() => setActiveConfigSub(sub.key)}
                      className={cn(
                        "w-full flex items-center gap-2 py-1.5 rounded-md text-xs transition-all border-l-[2px]",
                        activeConfigSub === sub.key
                          ? "bg-sidebar-primary text-sidebar-primary-foreground border-primary/70 pl-2.5 pr-3"
                          : "text-sidebar-foreground hover:bg-sidebar-accent/50 border-transparent px-3"
                      )}
                    >
                      <ChevronRight className={cn("w-3 h-3 flex-shrink-0 transition-transform", activeConfigSub === sub.key && "rotate-90")} />
                      <Settings2 className="w-3.5 h-3.5 flex-shrink-0" />
                      <span className="flex-1 text-left">{sub.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      <div className="border-t border-sidebar-border">
        <button
          onClick={signOut}
          className="w-full px-4 py-2.5 text-xs text-sidebar-foreground/70 hover:bg-red-500/10 hover:text-red-400 transition-all flex items-center gap-2 group"
        >
          <LogOut className="w-3.5 h-3.5 group-hover:text-red-400 transition-colors" />
          {!collapsed && <span>ออกจากระบบ</span>}
        </button>
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="w-full px-4 py-2.5 border-t border-sidebar-border text-xs text-sidebar-foreground/40 hover:text-sidebar-foreground hover:bg-sidebar-accent/50 transition-all flex items-center gap-2 justify-center"
        >
          {collapsed
            ? <ChevronRight className="w-3.5 h-3.5" />
            : <><ChevronLeft className="w-3.5 h-3.5" /><span>ย่อเมนู</span></>
          }
        </button>
      </div>
    </aside>
  );
}
