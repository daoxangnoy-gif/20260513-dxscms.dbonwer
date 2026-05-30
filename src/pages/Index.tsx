import { useState, useEffect, useMemo } from "react";
import { useAuth } from "@/hooks/useAuth";
import LoginPage from "@/pages/LoginPage";
import PendingApprovalPage from "@/pages/PendingApprovalPage";
import AppSidebar, { MainPage } from "@/components/AppSidebar";
import DataControlPage from "@/pages/DataControlPage";
import RangeStorePage from "@/pages/RangeStorePage";
import MinmaxCalPage from "@/pages/MinmaxCalPage";
import SRRPage from "@/pages/SRRPage";
import ReportPage from "@/pages/ReportPage";
import LogPage from "@/pages/LogPage";
import LogPoCostPage from "@/pages/LogPoCostPage";
import UserManagementPage from "@/pages/UserManagementPage";
import ConfigColumnExportPage from "@/pages/ConfigColumnExportPage";
import ConfigFilterPage from "@/pages/ConfigFilterPage";
import { AllTableName, DATA_TABLES, SRR_SUB_MENUS, REPORT_SUB_MENUS } from "@/lib/tableConfig";
import { Loader2, BarChart3 } from "lucide-react";

const PAGE_TO_MENU: Record<MainPage, string> = {
  data_control: "data_control",
  srr: "srr",
  user_control: "admin",
  report: "report",
  log: "log",
  config: "config",
};

const Index = () => {
  const { user, loading, userPermissions, canViewMenu, isAdmin } = useAuth();
  const [currentPage, setCurrentPage] = useState<MainPage>("data_control");
  const [activeTable, setActiveTable] = useState<AllTableName>("data_master");
  const [activeSrrSub, setActiveSrrSub] = useState("dc_item");

  // Deep-link: ?send_docs_dest=<id> → jump to SRR > Send Docs (used by "ถึงปลายทาง" new tab)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("send_docs_dest")) {
      setCurrentPage("srr");
      setActiveSrrSub("srr_send_docs");
    }
  }, []);

  const [activeLogSub, setActiveLogSub] = useState("log_po_cost");
  const [activeReportSub, setActiveReportSub] = useState("report_po");
  const [activeConfigSub, setActiveConfigSub] = useState("config_column_export");

  const canSeePage = (p: MainPage) => isAdmin || canViewMenu(PAGE_TO_MENU[p]);

  // Pick first allowed page on first load / when permissions change
  const firstAllowedPage = useMemo<MainPage | null>(() => {
    const order: MainPage[] = ["data_control", "srr", "report", "user_control", "log"];
    return order.find(canSeePage) ?? null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userPermissions, isAdmin]);

  useEffect(() => {
    if (firstAllowedPage && !canSeePage(currentPage)) setCurrentPage(firstAllowedPage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstAllowedPage]);

  // Pick first allowed Data Control table
  useEffect(() => {
    if (currentPage !== "data_control") return;
    const allowed = DATA_TABLES.filter(t => isAdmin || canViewMenu(t.name));
    if (allowed.length && !allowed.find(t => t.name === activeTable)) {
      setActiveTable(allowed[0].name);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, userPermissions, isAdmin]);

  // Pick first allowed SRR sub
  useEffect(() => {
    if (currentPage !== "srr") return;
    const allowed = SRR_SUB_MENUS.filter(s => isAdmin || canViewMenu(s.key));
    if (allowed.length && !allowed.find(s => s.key === activeSrrSub)) {
      setActiveSrrSub(allowed[0].key);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, userPermissions, isAdmin]);

  // Pick first allowed Report sub
  useEffect(() => {
    if (currentPage !== "report") return;
    const allowed = REPORT_SUB_MENUS.filter(s => isAdmin || canViewMenu(s.menuCode));
    if (allowed.length && !allowed.find(s => s.key === activeReportSub)) {
      setActiveReportSub(allowed[0].key);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, userPermissions, isAdmin]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) return <LoginPage />;

  if (!userPermissions) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!userPermissions.is_active || !userPermissions.role_name) {
    return <PendingApprovalPage />;
  }

  if (!firstAllowedPage) {
    return (
      <div className="flex h-screen items-center justify-center p-8 text-center">
        <div>
          <p className="text-lg font-semibold mb-2">ไม่มีสิทธิ์เข้าถึงเมนูใดเลย</p>
          <p className="text-sm text-muted-foreground">กรุณาติดต่อ Admin เพื่อขอสิทธิ์</p>
        </div>
      </div>
    );
  }

  const tableAllowed = isAdmin || canViewMenu(activeTable);

  return (
    <div className="flex h-screen overflow-hidden">
      <AppSidebar
        currentPage={currentPage}
        setCurrentPage={setCurrentPage}
        activeTable={activeTable}
        setActiveTable={setActiveTable}
        activeSrrSub={activeSrrSub}
        setActiveSrrSub={setActiveSrrSub}
        activeLogSub={activeLogSub}
        setActiveLogSub={setActiveLogSub}
        activeReportSub={activeReportSub}
        setActiveReportSub={setActiveReportSub}
        activeConfigSub={activeConfigSub}
        setActiveConfigSub={setActiveConfigSub}
      />
      <main className="flex-1 overflow-hidden">
        {currentPage === "data_control" && !tableAllowed && (
          <div className="flex h-full items-center justify-center text-muted-foreground">ไม่มีสิทธิ์เข้าถึงตารางนี้</div>
        )}
        {currentPage === "data_control" && tableAllowed && activeTable === "range_store" && <RangeStorePage />}
        {currentPage === "data_control" && tableAllowed && activeTable === "minmax" && <MinmaxCalPage />}
        {currentPage === "data_control" && tableAllowed && activeTable !== "range_store" && activeTable !== "minmax" && <DataControlPage activeTable={activeTable} />}
        {currentPage === "srr" && <SRRPage activeSub={activeSrrSub} />}
        {currentPage === "user_control" && <UserManagementPage />}
        {currentPage === "report" && activeReportSub === "report_po" && <ReportPage />}
        {currentPage === "report" && activeReportSub === "report_oos" && (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-muted-foreground">
            <BarChart3 className="w-12 h-12 text-muted-foreground/40" />
            <div className="text-lg font-medium">Report OOS</div>
            <div className="text-sm">Coming soon</div>
          </div>
        )}
        {currentPage === "report" && activeReportSub === "report_doh" && (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-muted-foreground">
            <BarChart3 className="w-12 h-12 text-muted-foreground/40" />
            <div className="text-lg font-medium">Report DOH</div>
            <div className="text-sm">Coming soon</div>
          </div>
        )}
        {currentPage === "config" && activeConfigSub === "config_column_export" && <ConfigColumnExportPage />}
        {currentPage === "config" && activeConfigSub === "config_filter" && <ConfigFilterPage />}
        {currentPage === "log" && activeLogSub === "log_po_cost" && <LogPoCostPage />}
        {currentPage === "log" && activeLogSub !== "log_po_cost" && <LogPage />}
      </main>
    </div>
  );
};

export default Index;
