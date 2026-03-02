import type { Tab } from "@/stores/media-panel-store";

export type HomeRouteTab = "dashboard" | "settings";
export type ProjectRouteTab = Exclude<Tab, "dashboard">;

export const PROJECT_ROUTE_TABS: readonly ProjectRouteTab[] = [
  "script",
  "characters",
  "scenes",
  "freedom",
  "director",
  "sclass",
  "media",
  "export",
  "settings",
] as const;

export function isProjectRouteTab(value: string): value is ProjectRouteTab {
  return (PROJECT_ROUTE_TABS as readonly string[]).includes(value);
}

export function buildHomePath(tab: HomeRouteTab = "dashboard"): string {
  return tab === "settings" ? "/home/settings" : "/home";
}

export function buildProjectPath(projectId: string, tab: ProjectRouteTab = "script"): string {
  return `/projects/${encodeURIComponent(projectId)}/${tab}`;
}

export type ParsedAppRoute =
  | { kind: "landing" }
  | { kind: "home"; tab: HomeRouteTab }
  | { kind: "project"; projectId: string; tab: ProjectRouteTab }
  | { kind: "invalid" };

export function parseAppPath(pathname: string): ParsedAppRoute {
  const segments = pathname.split("/").filter(Boolean);

  if (segments.length === 0) {
    return { kind: "landing" };
  }

  if (segments[0] === "home") {
    if (segments.length === 1) {
      return { kind: "home", tab: "dashboard" };
    }

    if (segments.length === 2 && segments[1] === "settings") {
      return { kind: "home", tab: "settings" };
    }

    return { kind: "invalid" };
  }

  if (segments[0] === "projects") {
    if (segments.length < 2 || segments.length > 3) {
      return { kind: "invalid" };
    }

    const projectId = decodeURIComponent(segments[1] ?? "").trim();
    if (!projectId) {
      return { kind: "invalid" };
    }

    if (segments.length === 2) {
      return { kind: "project", projectId, tab: "script" };
    }

    const tab = segments[2];
    if (!tab || !isProjectRouteTab(tab)) {
      return { kind: "invalid" };
    }

    return { kind: "project", projectId, tab };
  }

  return { kind: "invalid" };
}
