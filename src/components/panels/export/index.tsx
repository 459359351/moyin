// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
"use client";

/**
 * Export View - Timeline visualization and export
 * Based on CineGen-AI StageExport.tsx
 */

import { useState } from "react";
import { useActiveScriptProject } from "@/stores/script-store";
import { useActiveDirectorProject } from "@/stores/director-store";
import { useProjectStore } from "@/stores/project-store";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import {
  Film,
  Download,
  Share2,
  FileVideo,
  Layers,
  Clock,
  CheckCircle,
  BarChart3,
  Clapperboard,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

// Convert seconds to SMPTE timecode (HH:MM:SS:FF at 24fps)
function toTimecode(seconds: number, fps: number = 24): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const f = Math.floor((seconds % 1) * fps);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}:${String(f).padStart(2, '0')}`;
}

export function ExportView() {
  const { activeProject } = useProjectStore();
  const scriptProject = useActiveScriptProject();
  const directorProject = useActiveDirectorProject();
  const [isDownloading, setIsDownloading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  const shots = scriptProject?.shots || [];
  const splitScenes = directorProject?.splitScenes || [];
  const scriptData = scriptProject?.scriptData;
  const targetDuration = scriptProject?.targetDuration || "60s";
  const projectTitle = scriptData?.title || activeProject?.name || "未命名项目";

  // === 进度计算：合并 Script shots 和 Director splitScenes 的状态 ===
  const directorCompleted = splitScenes.filter(
    (s) => s.videoStatus === 'completed' || (s.imageStatus === 'completed' && s.videoUrl)
  ).length;
  const directorWithImage = splitScenes.filter((s) => s.imageStatus === 'completed').length;
  const scriptCompleted = shots.filter((s) => s.imageUrl || s.videoUrl).length;

  const hasSplitScenes = splitScenes.length > 0;
  const totalItems = hasSplitScenes ? splitScenes.length : shots.length;
  const completedItems = hasSplitScenes ? directorCompleted : scriptCompleted;
  const imageReadyItems = hasSplitScenes ? directorWithImage : scriptCompleted;
  const progress = totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0;
  const imageProgress = totalItems > 0 ? Math.round((imageReadyItems / totalItems) * 100) : 0;

  const estimatedDuration = hasSplitScenes
    ? splitScenes.reduce((acc, s) => acc + (s.duration || 5), 0)
    : shots.reduce((acc, s) => acc + (s.duration || 3), 0);

  // === Download Master ===
  const handleDownloadMaster = async () => {
    setIsDownloading(true);
    try {
      // Collect all video URLs
      const videoEntries: Array<{ name: string; url: string; duration: number }> = [];
      if (hasSplitScenes) {
        splitScenes.forEach((scene, idx) => {
          if (scene.videoUrl) {
            videoEntries.push({
              name: `scene_${String(idx + 1).padStart(2, '0')}.mp4`,
              url: scene.videoUrl,
              duration: scene.duration || 5,
            });
          }
        });
      } else {
        shots.forEach((shot, idx) => {
          if (shot.videoUrl) {
            videoEntries.push({
              name: `shot_${String(idx + 1).padStart(2, '0')}.mp4`,
              url: shot.videoUrl,
              duration: shot.duration || 3,
            });
          }
        });
      }

      if (videoEntries.length === 0) {
        toast.error('没有可下载的视频片段');
        return;
      }

      if (videoEntries.length === 1) {
        // Single video — download directly
        toast.info('正在下载视频...');
        const resp = await fetch(videoEntries[0].url);
        const blob = await resp.blob();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${projectTitle}_master.mp4`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(a.href);
        toast.success('视频下载完成');
      } else {
        // Multiple videos — download individually in sequence
        toast.info(`正在下载 ${videoEntries.length} 个视频片段...`);

        for (let i = 0; i < videoEntries.length; i++) {
          try {
            toast.info(`正在下载 ${i + 1}/${videoEntries.length}: ${videoEntries[i].name}`);
            const resp = await fetch(videoEntries[i].url);
            const blob = await resp.blob();
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `${projectTitle}_${videoEntries[i].name}`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(a.href);
            // Small delay between downloads to prevent browser blocking
            if (i < videoEntries.length - 1) {
              await new Promise(r => setTimeout(r, 500));
            }
          } catch (err) {
            console.warn(`[Export] Failed to download ${videoEntries[i].url}:`, err);
          }
        }

        toast.success(`已下载 ${videoEntries.length} 个视频片段`);
      }
    } catch (err) {
      console.error('[Export] Download failed:', err);
      toast.error('下载失败: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setIsDownloading(false);
    }
  };

  // === Export EDL ===
  const handleExportEdl = () => {
    setIsExporting(true);
    try {
      const fps = 24;
      const entries = hasSplitScenes
        ? splitScenes.map((s, i) => ({
          idx: i,
          name: s.sceneName || s.actionSummary || `Scene ${i + 1}`,
          duration: s.duration || 5,
          videoUrl: s.videoUrl || '',
        }))
        : shots.map((s, i) => ({
          idx: i,
          name: s.actionSummary || `Shot ${i + 1}`,
          duration: s.duration || 3,
          videoUrl: s.videoUrl || '',
        }));

      if (entries.length === 0) {
        toast.error('没有可导出的片段');
        setIsExporting(false);
        return;
      }

      // Generate EDL content
      let edl = `TITLE: ${projectTitle}\nFCM: NON-DROP FRAME\n\n`;
      let currentTC = 0;

      entries.forEach((entry, i) => {
        const eventNum = String(i + 1).padStart(3, '0');
        const srcIn = toTimecode(0, fps);
        const srcOut = toTimecode(entry.duration, fps);
        const recIn = toTimecode(currentTC, fps);
        const recOut = toTimecode(currentTC + entry.duration, fps);

        edl += `${eventNum}  AX       V     C        ${srcIn} ${srcOut} ${recIn} ${recOut}\n`;
        edl += `* FROM CLIP NAME: ${entry.name}\n`;
        if (entry.videoUrl) {
          edl += `* SOURCE FILE: ${entry.videoUrl}\n`;
        }
        edl += `\n`;

        currentTC += entry.duration;
      });

      // Download EDL file
      const blob = new Blob([edl], { type: 'text/plain;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${projectTitle}.edl`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);

      toast.success(`已导出 EDL 文件 (${entries.length} 个片段)`);
    } catch (err) {
      console.error('[Export] EDL export failed:', err);
      toast.error('导出失败: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-background overflow-hidden">
      {/* Header */}
      <div className="h-16 border-b border-white/5 dark:border-white/5 glass-panel z-10 sticky top-0 px-6 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-4">
          <h2 className="text-lg font-bold text-foreground flex items-center gap-3">
            <Film className="w-5 h-5 text-primary" />
            成片与导出
            <span className="text-xs text-muted-foreground font-mono font-normal uppercase tracking-wider bg-muted px-2 py-1 rounded">
              Rendering & Export
            </span>
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground font-mono uppercase bg-muted border border-border px-2 py-1 rounded">
            Status: {progress === 100 ? "READY" : "IN PROGRESS"}
          </span>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-8 md:p-12">
          <div className="max-w-6xl mx-auto space-y-8">
            {/* Main Status Panel */}
            <div className="bg-card/80 backdrop-blur-xl border border-white/10 dark:border-white/5 rounded-2xl p-8 shadow-2xl relative overflow-hidden">
              {/* Background Decoration */}
              <div className="absolute top-0 right-0 p-48 bg-primary/5 blur-[120px] rounded-full pointer-events-none" />
              <div className="absolute bottom-0 left-0 p-32 bg-green-500/5 blur-[100px] rounded-full pointer-events-none" />

              <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-10 relative z-10 gap-6">
                <div>
                  <div className="flex items-center gap-3 mb-2">
                    <h3 className="text-2xl md:text-3xl font-bold text-foreground tracking-tight">
                      {projectTitle}
                    </h3>
                    <span className="px-2 py-0.5 bg-muted border border-border text-muted-foreground text-[10px] rounded uppercase font-mono tracking-wider">
                      Master Sequence
                    </span>
                  </div>
                  <div className="flex items-center gap-6 mt-3">
                    <div className="flex flex-col">
                      <span className="text-[9px] text-muted-foreground uppercase tracking-widest font-bold mb-0.5">
                        {hasSplitScenes ? 'Split Scenes' : 'Shots'}
                      </span>
                      <span className="text-sm font-mono text-foreground/80">{totalItems}</span>
                    </div>
                    <div className="w-px h-6 bg-border" />
                    <div className="flex flex-col">
                      <span className="text-[9px] text-muted-foreground uppercase tracking-widest font-bold mb-0.5">
                        Est. Duration
                      </span>
                      <span className="text-sm font-mono text-foreground/80">~{estimatedDuration}s</span>
                    </div>
                    <div className="w-px h-6 bg-border" />
                    <div className="flex flex-col">
                      <span className="text-[9px] text-muted-foreground uppercase tracking-widest font-bold mb-0.5">
                        Target
                      </span>
                      <span className="text-sm font-mono text-foreground/80">{targetDuration}</span>
                    </div>
                  </div>
                </div>

                <div className="text-right glass p-4 rounded-xl border border-white/5 backdrop-blur-md min-w-[160px]">
                  <div className="flex items-baseline justify-end gap-1 mb-1">
                    <span className="text-3xl font-mono font-bold text-primary">{progress}</span>
                    <span className="text-sm text-muted-foreground">%</span>
                  </div>
                  <div className="text-[10px] text-muted-foreground uppercase tracking-widest flex items-center justify-end gap-2">
                    {progress === 100 ? (
                      <CheckCircle className="w-3 h-3 text-green-500" />
                    ) : (
                      <BarChart3 className="w-3 h-3" />
                    )}
                    Render Status
                  </div>
                </div>
              </div>

              {/* Timeline Visualizer Strip */}
              <div className="mb-10">
                <div className="flex justify-between text-[10px] text-muted-foreground font-mono uppercase tracking-widest mb-2 px-1">
                  <span>Sequence Map{hasSplitScenes ? ' (Director)' : ''}</span>
                  <span>TC 00:00:00:00</span>
                </div>
                <div className="h-20 bg-muted/30 rounded-lg border border-border flex items-center px-2 gap-1 overflow-x-auto relative shadow-inner">
                  {totalItems === 0 ? (
                    <div className="w-full flex items-center justify-center text-muted-foreground/50 text-xs font-mono uppercase tracking-widest">
                      <Film className="w-4 h-4 mr-2" />
                      No Shots Available
                    </div>
                  ) : hasSplitScenes ? (
                    splitScenes.map((scene, idx) => {
                      const hasImage = scene.imageStatus === 'completed' && !!scene.imageDataUrl;
                      const hasVideo = scene.videoStatus === 'completed' && !!scene.videoUrl;
                      return (
                        <div
                          key={scene.id}
                          className={cn(
                            "h-14 min-w-[4px] flex-1 rounded-sm transition-all duration-300 relative group flex flex-col justify-end overflow-hidden hover:scale-[1.02] cursor-pointer origin-bottom",
                            hasVideo
                              ? "bg-green-500/40 border border-green-500/30 hover:bg-green-500/60 shadow-[0_0_10px_rgba(34,197,94,0.2)]"
                              : hasImage
                                ? "bg-primary/40 border border-primary/30 hover:bg-primary/60 shadow-[0_0_10px_rgba(0,145,255,0.2)]"
                                : "bg-muted border border-white/5 hover:bg-muted/80"
                          )}
                          title={`Scene ${idx + 1}: ${scene.actionSummary || scene.sceneName || ''}`}
                        >
                          {hasVideo && <div className="h-full w-full bg-green-500/20" />}
                          {hasImage && !hasVideo && <div className="h-full w-full bg-primary/20" />}

                          {/* Hover Tooltip */}
                          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block z-20 whitespace-nowrap">
                            <div className="bg-popover text-popover-foreground text-[10px] px-2 py-1 rounded border border-border shadow-xl">
                              Scene {idx + 1}{hasVideo ? ' ✓视频' : hasImage ? ' ✓图片' : ''}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    shots.map((shot, idx) => {
                      const isDone = !!shot.imageUrl || !!shot.videoUrl;
                      return (
                        <div
                          key={shot.id}
                          className={cn(
                            "h-14 min-w-[4px] flex-1 rounded-sm transition-all duration-300 relative group flex flex-col justify-end overflow-hidden hover:scale-[1.02] cursor-pointer origin-bottom",
                            isDone
                              ? "bg-primary/40 border border-primary/30 hover:bg-primary/60 shadow-[0_0_10px_rgba(0,145,255,0.2)]"
                              : "bg-muted border border-white/5 hover:bg-muted/80"
                          )}
                          title={`Shot ${idx + 1}: ${shot.actionSummary}`}
                        >
                          {isDone && <div className="h-full w-full bg-primary/20" />}

                          {/* Hover Tooltip */}
                          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block z-20 whitespace-nowrap">
                            <div className="bg-popover text-popover-foreground text-[10px] px-2 py-1 rounded border border-border shadow-xl">
                              Shot {idx + 1}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
                {/* 图片/视频状态摘要 */}
                {hasSplitScenes && (
                  <div className="flex items-center gap-4 mt-2 text-[10px] text-muted-foreground">
                    <span>图片: {imageReadyItems}/{totalItems}</span>
                    <span>视频: {completedItems}/{totalItems}</span>
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Button
                  disabled={completedItems === 0 || isDownloading}
                  onClick={handleDownloadMaster}
                  className={cn(
                    "h-12 font-bold text-xs uppercase tracking-widest transition-all glass-panel border border-white/10 hover-lift",
                    completedItems > 0 && !isDownloading
                      ? "animated-gradient text-primary-foreground hover:brightness-110 shadow-lg shadow-primary/20"
                      : "bg-muted text-muted-foreground cursor-not-allowed opacity-50 hover-lift:none"
                  )}
                >
                  {isDownloading ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Download className="w-4 h-4 mr-2" />
                  )}
                  {isDownloading ? '下载中...' : 'Download Master (.mp4)'}
                </Button>

                <Button
                  variant="outline"
                  disabled={totalItems === 0 || isExporting}
                  onClick={handleExportEdl}
                  className={cn(
                    "h-12 font-bold text-xs uppercase tracking-widest transition-all glass border border-white/10 hover-lift",
                    (totalItems === 0 || isExporting) && "opacity-50 cursor-not-allowed hover-lift:none"
                  )}
                >
                  {isExporting ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <FileVideo className="w-4 h-4 mr-2" />
                  )}
                  {isExporting ? '导出中...' : 'Export EDL / XML'}
                </Button>
              </div>
            </div>

            {/* Secondary Options */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="p-5 glass border border-white/5 rounded-xl hover:border-primary/50 group cursor-pointer flex flex-col justify-between h-32 hover-lift">
                <Layers className="w-5 h-5 text-muted-foreground group-hover:text-primary mb-4 transition-colors" />
                <div>
                  <h4 className="text-sm font-bold text-foreground mb-1">Source Assets</h4>
                  <p className="text-[10px] text-muted-foreground">
                    Download all generated images and raw video clips.
                  </p>
                </div>
              </div>
              <div className="p-5 glass border border-white/5 rounded-xl hover:border-primary/50 group cursor-pointer flex flex-col justify-between h-32 hover-lift">
                <Share2 className="w-5 h-5 text-muted-foreground group-hover:text-primary mb-4 transition-colors" />
                <div>
                  <h4 className="text-sm font-bold text-foreground mb-1">Share Project</h4>
                  <p className="text-[10px] text-muted-foreground">
                    Create a view-only link for client review.
                  </p>
                </div>
              </div>
              <div className="p-5 glass border border-white/5 rounded-xl hover:border-primary/50 group cursor-pointer flex flex-col justify-between h-32 hover-lift">
                <Clock className="w-5 h-5 text-muted-foreground group-hover:text-primary mb-4 transition-colors" />
                <div>
                  <h4 className="text-sm font-bold text-foreground mb-1">Render Logs</h4>
                  <p className="text-[10px] text-muted-foreground">
                    View generation history and token usage.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}

