import { useState, useEffect } from "react";
import {
  Database, BarChart3, Package, ArrowUpDown, DollarSign,
  ShoppingCart, TrendingUp, Calendar, Truck,
  ChevronRight, ChevronDown, Users, FileText, History, Store,
  LogOut, Shield, Settings2, Pin, PinOff,
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
  pinned: boolean;
  onPinnedChange: (pinned: boolean) => void;
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

export default function AppSidebar({
  currentPage, setCurrentPage,
  activeTable, setActiveTable,
  activeSrrSub, setActiveSrrSub,
  activeLogSub, setActiveLogSub,
  activeReportSub, setActiveReportSub,
  activeConfigSub, setActiveConfigSub,
  pinned, onPinnedChange,
}: AppSidebarProps) {
  const { canViewMenu, userPermissions, signOut, isAdmin } = useAuth();

  const [isHovered, setIsHovered] = useState(false);
  const [dataExpanded, setDataExpanded] = useState(true);
  const [srrExpanded, setSrrExpanded] = useState(false);
  const [logExpanded, setLogExpanded] = useState(false);
  const [reportExpanded, setReportExpanded] = useState(false);
  const [configExpanded, setConfigExpanded] = useState(false);
  const [counts, setCounts] = useState<Record<string, number>>({});

  const expanded = pinned || isHovered;

  const togglePin = () => {
    const next = !pinned;
    try { localStorage.setItem("sidebar_pinned", next ? "1" : "0"); } catch {}
    onPinnedChange(next);
  };

  const handleMainClick = (key: MainPage) => {
    setCurrentPage(key);
    setDataExpanded(key === "data_control");
    setSrrExpanded(key === "srr");
    setLogExpanded(key === "log");
    setReportExpanded(key === "report");
    setConfigExpanded(key === "config");
  };

  useEffect(() => {
    if (currentPage !== "data_control") return;
    const CACHE_KEY = "sidebar_table_counts";
    const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
    try {
      const cached = sessionStorage.getItem(CACHE_KEY);
      if (cached) {
        const { ts, data } = JSON.parse(cached);
        if (Date.now() - ts < CACHE_TTL) {
          setCounts(data);
          return;
        }
      }
    } catch {}
    const loadCounts = async () => {
      const tables = DATA_TABLES.filter(t => t.name !== "range_store");
      const entries = await Promise.all(
        tables.map(async t => {
          const { count } = await supabase.from(t.name).select("*", { count: "exact", head: true });
          return [t.name, count || 0] as const;
        })
      );
      const data = Object.fromEntries(entries);
      setCounts(data);
      try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data })); } catch {}
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

  const mainMenus = allMenus.filter(m => isAdmin || canViewMenu(m.menuCode));
  const visibleSrrSubs = SRR_SUB_MENUS.filter(s => isAdmin || canViewMenu(s.key));
  const visibleDataTables = DATA_TABLES.filter(t => isAdmin || canViewMenu(t.name));

  return (
    <aside
      className={cn(
        "fixed left-0 top-0 h-full z-40",
        "flex flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border",
        "transition-[width,box-shadow] duration-200 ease-in-out",
        expanded ? "w-60 shadow-xl" : "w-12 shadow-none"
      )}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Header */}
      <div className={cn(
        "flex items-center h-14 border-b border-sidebar-border flex-shrink-0 gap-2",
        expanded ? "px-3" : "px-0 justify-center"
      )}>
        <div className={cn(
          "bg-white rounded-md flex items-center justify-center flex-shrink-0 shadow-sm ring-1 ring-black/5",
          expanded ? "p-1" : "p-0.5"
        )}>
          <img src={appLogo} alt="DX SCMS" className={cn("w-auto", expanded ? "h-8" : "h-10")} />
        </div>
        {expanded && (
          <>
            <span className="font-bold text-sm text-sidebar-accent-foreground flex-1 truncate">DX SCMS</span>
            <button
              onClick={togglePin}
              className="p-1.5 rounded hover:bg-sidebar-accent/50 text-sidebar-foreground/50 hover:text-sidebar-foreground transition-colors flex-shrink-0"
              title={pinned ? "Unpin sidebar (คลิกเพื่อปล่อย)" : "Pin sidebar (คลิกเพื่อยึด)"}
            >
              {pinned
                ? <PinOff className="w-3.5 h-3.5" />
                : <Pin className="w-3.5 h-3.5" />
              }
            </button>
          </>
        )}
      </div>

      {/* User info */}
      {expanded && userPermissions && (
        <div className="px-4 py-2 border-b border-sidebar-border flex-shrink-0">
          <div className="text-xs font-medium text-sidebar-foreground truncate">{userPermissions.role_name}</div>
          {userPermissions.spc_name && (
            <div className="text-[10px] text-muted-foreground">SPC: {userPermissions.spc_name}</div>
          )}
        </div>
      )}

      <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-1">
        {mainMenus.map(menu => {
          const isActive = currentPage === menu.key;
          const hasSubMenu = ["data_control", "srr", "log", "report", "config"].includes(menu.key);
          const isExpanded =
            menu.key === "data_control" ? dataExpanded :
            menu.key === "srr" ? srrExpanded :
            menu.key === "log" ? logExpanded :
            menu.key === "report" ? reportExpanded :
            menu.key === "config" ? configExpanded : false;

          return (
            <div key={menu.key}>
              <div className="flex items-center">
                <button
                  onClick={() => handleMainClick(menu.key)}
                  className={cn(
                    "flex-1 flex items-center gap-2 py-2 rounded-md text-sm font-semibold transition-all border-l-[3px]",
                    expanded
                      ? (isActive ? "pl-2.5 pr-3" : "px-3")
                      : "justify-center px-0",
                    isActive
                      ? "bg-sidebar-accent text-sidebar-accent-foreground border-primary"
                      : "text-sidebar-foreground hover:bg-sidebar-accent/50 border-transparent"
                  )}
                >
                  <menu.icon className="w-4 h-4 flex-shrink-0" />
                  {expanded && <span className="truncate">{menu.label}</span>}
                </button>
                {expanded && hasSubMenu && (
                  <button
                    onClick={() => {
                      if (menu.key === "data_control") setDataExpanded(v => !v);
                      if (menu.key === "srr") setSrrExpanded(v => !v);
                      if (menu.key === "log") setLogExpanded(v => !v);
                      if (menu.key === "report") setReportExpanded(v => !v);
                      if (menu.key === "config") setConfigExpanded(v => !v);
                    }}
                    className="p-1 rounded hover:bg-sidebar-accent/50 text-sidebar-foreground/60 transition-colors"
                  >
                    <ChevronDown className={cn("w-3.5 h-3.5 transition-transform duration-200", isExpanded ? "rotate-0" : "-rotate-90")} />
                  </button>
                )}
              </div>

              {/* Data Control sub-menus */}
              {expanded && menu.key === "data_control" && dataExpanded && (
                <div className="ml-2 space-y-0.5">
                  {visibleDataTables.map((t) => {
                    const Icon = ICONS[t.name] || Database;
                    const count = counts[t.name] || 0;
                    return (
                      <button
                        key={t.name}
                        onClick={() => { setCurrentPage("data_control"); setActiveTable(t.name); }}
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
              {expanded && menu.key === "srr" && srrExpanded && (
                <div className="ml-2 space-y-0.5">
                  {visibleSrrSubs.map((sub) => (
                    <button
                      key={sub.key}
                      onClick={() => { setCurrentPage("srr"); setActiveSrrSub(sub.key); }}
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

              {/* Admin sub-menu */}
              {expanded && menu.key === "user_control" && currentPage === "user_control" && (
                <div className="ml-2 space-y-0.5">
                  <button className="w-full flex items-center gap-2 px-3 py-1.5 rounded-md text-xs bg-sidebar-primary text-sidebar-primary-foreground">
                    <ChevronRight className="w-3 h-3 flex-shrink-0 rotate-90" />
                    <Users className="w-3.5 h-3.5 flex-shrink-0" />
                    <span className="flex-1 text-left">User Management</span>
                  </button>
                </div>
              )}

              {/* Log sub-menus */}
              {expanded && menu.key === "log" && logExpanded && (
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
              {expanded && menu.key === "report" && reportExpanded && (
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
              {expanded && menu.key === "config" && configExpanded && (
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

      {/* Footer */}
      <div className="border-t border-sidebar-border flex-shrink-0">
        <button
          onClick={signOut}
          className={cn(
            "w-full py-2.5 text-xs text-sidebar-foreground/70 hover:bg-red-500/10 hover:text-red-400 transition-all flex items-center gap-2 group",
            expanded ? "px-4" : "justify-center"
          )}
        >
          <LogOut className="w-3.5 h-3.5 group-hover:text-red-400 transition-colors flex-shrink-0" />
          {expanded && <span>ออกจากระบบ</span>}
        </button>
      </div>
    </aside>
  );
}
