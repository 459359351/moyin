// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
import { useEffect, useRef, useState } from "react";
import { BrowserRouter, Routes, Route, useLocation, useNavigate } from "react-router-dom";
import { Layout } from "@/components/Layout";
import { LandingPage } from "@/components/landing/LandingPage";
import { Toaster } from "@/components/ui/sonner";
import { useThemeStore } from "@/stores/theme-store";
import { useAPIConfigStore } from "@/stores/api-config-store";
import { useMediaPanelStore, Tab } from "@/stores/media-panel-store";
import { useProjectStore } from "@/stores/project-store";
import { parseApiKeys } from "@/lib/api-key-manager";
import { Loader2 } from "lucide-react";
import { migrateToProjectStorage, recoverFromLegacy } from "@/lib/storage-migration";
import { switchProject } from "@/lib/project-switcher";
import { buildHomePath, buildProjectPath, parseAppPath } from "@/lib/app-routes";

function resolvePathFromState(inProject: boolean, activeProjectId: string | null, activeTab: Tab): string {
  if (inProject && activeProjectId) {
    const projectTab = activeTab === "dashboard" ? "script" : activeTab;
    return buildProjectPath(activeProjectId, projectTab);
  }

  return activeTab === "settings" ? buildHomePath("settings") : buildHomePath("dashboard");
}

function RouteStateSync() {
  const navigate = useNavigate();
  const location = useLocation();

  const inProject = useMediaPanelStore((state) => state.inProject);
  const activeTab = useMediaPanelStore((state) => state.activeTab);
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const projects = useProjectStore((state) => state.projects);
  const ensureDefaultProject = useProjectStore((state) => state.ensureDefaultProject);

  const applyingRouteRef = useRef(false);

  // Ensure there is always at least one project after rehydration.
  useEffect(() => {
    ensureDefaultProject();
  }, [ensureDefaultProject]);

  // URL -> stores
  useEffect(() => {
    let cancelled = false;

    const applyRoute = async () => {
      applyingRouteRef.current = true;
      try {
        const parsed = parseAppPath(location.pathname);

        if (parsed.kind === "invalid") {
          navigate(buildHomePath(), { replace: true });
          return;
        }

        if (parsed.kind === "landing") {
          // Do nothing, stay on landing page
          return;
        }

        if (parsed.kind === "home") {
          const media = useMediaPanelStore.getState();
          if (parsed.tab === "dashboard") {
            if (media.inProject || media.activeTab !== "dashboard") {
              media.setInProject(false);
            }
            return;
          }

          if (media.inProject) {
            media.setInProject(false);
          }
          if (media.activeTab !== "settings") {
            media.setActiveTab("settings");
          }
          return;
        }

        const canonicalPath = buildProjectPath(parsed.projectId, parsed.tab);
        if (location.pathname !== canonicalPath) {
          navigate(canonicalPath, { replace: true });
        }

        const projectExists = useProjectStore
          .getState()
          .projects.some((project) => project.id === parsed.projectId);

        if (!projectExists) {
          navigate(buildHomePath(), { replace: true });
          return;
        }

        if (useProjectStore.getState().activeProjectId !== parsed.projectId) {
          await switchProject(parsed.projectId);
        }

        const media = useMediaPanelStore.getState();
        if (!media.inProject || media.activeTab !== parsed.tab) {
          media.setActiveTab(parsed.tab);
        }
      } catch (error) {
        console.error("[RouteStateSync] Failed to apply route:", error);
      } finally {
        if (!cancelled) {
          applyingRouteRef.current = false;
        }
      }
    };

    void applyRoute();

    return () => {
      cancelled = true;
      applyingRouteRef.current = false;
    };
  }, [location.pathname, navigate, projects]);

  // stores -> URL
  useEffect(() => {
    if (applyingRouteRef.current) {
      return;
    }

    if (location.pathname === "/") {
      return; // Do not auto-redirect away from landing page
    }

    const targetPath = resolvePathFromState(inProject, activeProjectId, activeTab);
    if (location.pathname !== targetPath) {
      navigate(targetPath);
    }
  }, [inProject, activeProjectId, activeTab, location.pathname, navigate]);

  return null;
}

function AppContent() {
  return (
    <BrowserRouter>
      <RouteStateSync />
      <Routes>
        <Route path="/" element={
          <div className="h-screen w-screen overflow-y-auto overflow-x-hidden">
            <LandingPage />
          </div>
        } />
        <Route path="*" element={
          <div className="h-screen w-screen overflow-hidden">
            <Layout />
            <Toaster richColors position="top-center" />
          </div>
        } />
      </Routes>
    </BrowserRouter>
  );
}

function App() {
  const { theme } = useThemeStore();
  const [isMigrating, setIsMigrating] = useState(true);

  // 启动时运行存储迁移 + 数据恢复
  useEffect(() => {
    (async () => {
      try {
        await migrateToProjectStorage();
        await recoverFromLegacy();
      } catch (err) {
        console.error("[App] Migration/recovery error:", err);
      } finally {
        setIsMigrating(false);
      }
    })();
  }, []);

  // 启动时自动同步所有已配置 API Key 的供应商模型元数据
  useEffect(() => {
    if (isMigrating) return;
    const { providers, syncProviderModels } = useAPIConfigStore.getState();
    for (const p of providers) {
      if (parseApiKeys(p.apiKey).length > 0) {
        syncProviderModels(p.id).then((result) => {
          if (result.success) {
            console.log(`[App] Auto-synced ${p.name}: ${result.count} models`);
          }
        });
      }
    }
  }, [isMigrating]);

  // 同步主题到 html 元素
  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("light", "dark");
    root.classList.add(theme);
  }, [theme]);

  // 迁移中显示加载界面
  if (isMigrating) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-muted-foreground">正在初始化...</p>
        </div>
      </div>
    );
  }

  return <AppContent />;
}

export default App;
