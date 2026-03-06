// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
import { mainNavItems, bottomNavItems, Tab, useMediaPanelStore } from "@/stores/media-panel-store";
import { useThemeStore } from "@/stores/theme-store";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ChevronLeft, LayoutDashboard, Settings, Sun, Moon, HelpCircle, Home } from "lucide-react";
import { useNavigate } from "react-router-dom";

export function TabBar() {
  const { activeTab, inProject, setActiveTab, setInProject } = useMediaPanelStore();
  const { theme, toggleTheme } = useThemeStore();
  const navigate = useNavigate();

  const goToLandingPage = () => navigate('/');

  // Dashboard mode
  if (!inProject) {
    return (
      <div className="flex flex-col w-14 bg-panel border-r border-border py-2">
        <div className="p-2">
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={goToLandingPage}
                  className="w-8 h-8 bg-primary text-primary-foreground flex items-center justify-center mx-auto rounded hover:opacity-80 transition-opacity cursor-pointer"
                >
                  <span className="text-sm font-bold">M</span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">返回官网主页</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        {/* Dashboard nav */}
        <nav className="flex-1 py-1">
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setActiveTab("dashboard")}
                  className={cn(
                    "w-full flex flex-col items-center py-2.5 transition-colors",
                    activeTab === "dashboard"
                      ? "text-primary bg-primary/10"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                  )}
                >
                  <LayoutDashboard className="h-5 w-5 mb-0.5" />
                  <span className="text-[9px]">项目</span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">项目仪表盘</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </nav>
        {/* Bottom: Home + Help + Settings + Theme */}
        <div className="mt-auto border-t border-border py-1">
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={goToLandingPage}
                  className="w-full flex flex-col items-center py-2 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                >
                  <Home className="h-4 w-4" />
                  <span className="text-[8px]">主页</span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">返回官网主页</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <a
                  href="https://dcn2kzs1g73g.feishu.cn/wiki/JEy5w2r5ZiY341kv55rclyd2n0O"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full flex flex-col items-center py-2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  <HelpCircle className="h-4 w-4" />
                  <span className="text-[8px]">帮助</span>
                </a>
              </TooltipTrigger>
              <TooltipContent side="right">使用帮助</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setActiveTab("settings")}
                  className={cn(
                    "w-full flex flex-col items-center py-2 transition-colors",
                    activeTab === "settings" ? "text-primary" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Settings className="h-4 w-4" />
                  <span className="text-[8px]">设置</span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">系统设置</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          {/* Theme Toggle */}
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={toggleTheme}
                  className="w-full flex flex-col items-center py-2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                  <span className="text-[8px]">{theme === "dark" ? "浅色" : "深色"}</span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">
                {theme === "dark" ? "切换到浅色模式" : "切换到深色模式"}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div >
    );
  }

  // Project mode - flat navigation
  return (
    <div className="flex flex-col w-14 bg-panel border-r border-border">
      {/* Logo + Back */}
      <div className="p-2 border-b border-border">
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={goToLandingPage}
                className="w-8 h-8 bg-primary text-primary-foreground flex items-center justify-center mx-auto rounded mb-1 hover:opacity-80 transition-opacity cursor-pointer"
              >
                <span className="text-sm font-bold">M</span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">返回官网主页</TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setInProject(false)}
                className="flex items-center justify-center w-full h-5 text-muted-foreground hover:text-foreground"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">返回项目列表</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      {/* Main Navigation */}
      <nav className="flex-1 py-1">
        {mainNavItems.map((item) => {
          const isActive = activeTab === item.id;
          const Icon = item.icon;

          return (
            <TooltipProvider key={item.id} delayDuration={300}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => setActiveTab(item.id)}
                    className={cn(
                      "w-full flex flex-col items-center py-2.5 transition-colors",
                      isActive
                        ? "text-primary bg-primary/10"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                    )}
                  >
                    <Icon className="h-5 w-5 mb-0.5" />
                    <span className="text-[9px]">{item.label}</span>
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">
                  {item.label}{item.phase ? ` (Phase ${item.phase})` : ""}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          );
        })}
      </nav>

      {/* Bottom: Home + Help + Settings + Theme */}
      <div className="mt-auto border-t border-border py-1">
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={goToLandingPage}
                className="w-full flex flex-col items-center py-2 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
              >
                <Home className="h-4 w-4" />
                <span className="text-[8px]">主页</span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">返回官网主页</TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <a
                href="https://dcn2kzs1g73g.feishu.cn/wiki/JEy5w2r5ZiY341kv55rclyd2n0O"
                target="_blank"
                rel="noopener noreferrer"
                className="w-full flex flex-col items-center py-2 text-muted-foreground hover:text-foreground transition-colors"
              >
                <HelpCircle className="h-4 w-4" />
                <span className="text-[8px]">帮助</span>
              </a>
            </TooltipTrigger>
            <TooltipContent side="right"></TooltipContent>
          </Tooltip>
        </TooltipProvider>
        {bottomNavItems.map((item) => {
          const isActive = activeTab === item.id;
          const Icon = item.icon;

          return (
            <TooltipProvider key={item.id} delayDuration={300}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => setActiveTab(item.id)}
                    className={cn(
                      "w-full flex flex-col items-center py-2 transition-colors",
                      isActive ? "text-primary" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    <span className="text-[8px]">{item.label}</span>
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">{item.label}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          );
        })}
        {/* Theme Toggle */}
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={toggleTheme}
                className="w-full flex flex-col items-center py-2 text-muted-foreground hover:text-foreground transition-colors"
              >
                {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                <span className="text-[8px]">{theme === "dark" ? "浅色" : "深色"}</span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">
              {theme === "dark" ? "切换到浅色模式" : "切换到深色模式"}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </div>
  );
}
