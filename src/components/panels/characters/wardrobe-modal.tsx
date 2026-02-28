// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
"use client";

/**
 * Wardrobe Modal Component
 * Manages character variations (outfits/states) with AI generation support
 * Inspired by CineGen-AI wardrobe system
 */

import { useState } from "react";
import {
  type Character,
  type CharacterVariation,
  useCharacterLibraryStore,
} from "@/stores/character-library-store";
import { getFeatureConfig, getFeatureNotConfiguredMessage } from "@/lib/ai/feature-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Plus,
  Trash2,
  Wand2,
  Loader2,
  Shirt,
  ImageIcon,
  Check,
  X,
  RotateCcw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { getStyleById } from "@/lib/constants/visual-styles";

// Preset variation types for quick creation
const VARIATION_PRESETS = [
  { name: "日常装", prompt: "casual everyday clothing, relaxed outfit" },
  { name: "正装", prompt: "formal attire, business suit, elegant clothing" },
  { name: "战斗装", prompt: "tactical gear, combat outfit, armor" },
  { name: "睡衣", prompt: "sleepwear, pajamas, nightwear" },
  { name: "运动装", prompt: "sportswear, athletic clothing, workout outfit" },
  { name: "受伤状态", prompt: "injured appearance, bandages, wounds" },
  { name: "雨天装扮", prompt: "raincoat, umbrella, wet weather gear" },
  { name: "冬装", prompt: "winter clothing, warm coat, scarf" },
] as const;

interface WardrobeModalProps {
  character: Character;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function WardrobeModal({ character, open, onOpenChange }: WardrobeModalProps) {
  const { addVariation, updateVariation, deleteVariation } = useCharacterLibraryStore();

  const [showAddForm, setShowAddForm] = useState(false);
  const [newVariationName, setNewVariationName] = useState("");
  const [newVariationPrompt, setNewVariationPrompt] = useState("");
  const [generatingVariationId, setGeneratingVariationId] = useState<string | null>(null);
  const [previewData, setPreviewData] = useState<{
    variationId: string;
    imageUrl: string;
  } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);

  const variations = character.variations || [];

  const handleAddVariation = () => {
    if (!newVariationName.trim()) {
      toast.error("请输入变体名称");
      return;
    }

    addVariation(character.id, {
      name: newVariationName.trim(),
      visualPrompt: newVariationPrompt.trim() || `${newVariationName.trim()} outfit`,
    });

    setNewVariationName("");
    setNewVariationPrompt("");
    setShowAddForm(false);
    toast.success("变体已添加");
  };

  const handleQuickAdd = (preset: typeof VARIATION_PRESETS[number]) => {
    addVariation(character.id, {
      name: preset.name,
      visualPrompt: preset.prompt,
    });
    toast.success(`已添加 "${preset.name}" 变体`);
  };

  const handleDeleteVariation = (variationId: string, name: string) => {
    setDeleteTarget({ id: variationId, name });
  };

  const confirmDeleteVariation = () => {
    if (!deleteTarget) return;
    deleteVariation(character.id, deleteTarget.id);
    toast.success("变体已删除");
    setDeleteTarget(null);
  };

  const handleGenerateVariation = async (variation: CharacterVariation) => {
    const featureConfig = getFeatureConfig('character_generation');
    if (!featureConfig) {
      toast.error(getFeatureNotConfiguredMessage('character_generation'));
      return;
    }
    const apiKey = featureConfig.apiKey;
    const provider = featureConfig.platform;

    // Need base character image for consistency
    if (!character.thumbnailUrl && character.views.length === 0) {
      toast.error("请先生成角色基础定妆照，以保持一致性");
      return;
    }

    setGeneratingVariationId(variation.id);

    try {
      // Build prompt combining base character with variation
      const basePrompt = character.visualTraits || character.description;
      const variationPrompt = `${basePrompt}, ${variation.visualPrompt}, same character, consistent face and body features`;

      // Get base reference image
      const referenceImage = character.thumbnailUrl || character.views[0]?.imageUrl;

      const imageUrl = await generateVariationImage(
        variationPrompt,
        apiKey,
        referenceImage,
        character.styleId,
        provider
      );

      // Show preview
      setPreviewData({
        variationId: variation.id,
        imageUrl,
      });

      toast.success("变体图片生成完成，请预览确认");
    } catch (error) {
      const err = error as Error;
      toast.error(`生成失败: ${err.message}`);
    } finally {
      setGeneratingVariationId(null);
    }
  };

  const handleSavePreview = () => {
    if (!previewData) return;

    updateVariation(character.id, previewData.variationId, {
      referenceImage: previewData.imageUrl,
      generatedAt: Date.now(),
    });

    setPreviewData(null);
    toast.success("变体图片已保存");
  };

  const handleDiscardPreview = () => {
    setPreviewData(null);
  };

  // If showing preview
  if (previewData) {
    const variation = variations.find(v => v.id === previewData.variationId);
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>预览变体图片 - {variation?.name}</DialogTitle>
            <DialogDescription>
              确认图片是否满意，满意则保存
            </DialogDescription>
          </DialogHeader>

          <div className="relative rounded-lg overflow-hidden border-2 border-amber-500/50 bg-muted">
            <img
              src={previewData.imageUrl}
              alt={`${character.name} - ${variation?.name}`}
              className="w-full h-auto"
            />
            <div className="absolute top-2 left-2 bg-amber-500 text-white text-xs px-2 py-1 rounded">
              预览
            </div>
          </div>

          <div className="flex gap-2">
            <Button onClick={handleSavePreview} className="flex-1">
              <Check className="h-4 w-4 mr-2" />
              保存
            </Button>
            <Button
              onClick={() => handleGenerateVariation(variation!)}
              variant="outline"
              disabled={generatingVariationId !== null}
            >
              <RotateCcw className="h-4 w-4 mr-2" />
              重新生成
            </Button>
          </div>

          <Button onClick={handleDiscardPreview} variant="ghost" className="w-full">
            放弃并返回
          </Button>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Shirt className="h-5 w-5" />
              {character.name} 的衣橱
            </DialogTitle>
            <DialogDescription>
              管理角色的不同造型变体，AI 生成时将保持面部特征一致
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Existing variations */}
            {variations.length > 0 && (
              <div className="space-y-2">
                <Label className="text-sm font-medium">已有变体 ({variations.length})</Label>
                <div className="grid grid-cols-2 gap-3">
                  {variations.map((variation) => (
                    <div
                      key={variation.id}
                      className={cn(
                        "p-3 rounded-lg border bg-card",
                        generatingVariationId === variation.id && "opacity-70"
                      )}
                    >
                      <div className="flex items-start gap-3">
                        {/* Thumbnail */}
                        <div className="w-16 h-16 rounded-md bg-muted flex items-center justify-center overflow-hidden flex-shrink-0">
                          {variation.referenceImage ? (
                            <img
                              src={variation.referenceImage}
                              alt={variation.name}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <ImageIcon className="w-6 h-6 text-muted-foreground" />
                          )}
                        </div>

                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <h4 className="font-medium text-sm truncate">{variation.name}</h4>
                            <Button
                              size="icon"
                              variant="text"
                              className="h-6 w-6 text-destructive"
                              onClick={() => handleDeleteVariation(variation.id, variation.name)}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                          <p className="text-xs text-muted-foreground truncate mt-0.5">
                            {variation.visualPrompt}
                          </p>

                          {/* Generate button */}
                          <Button
                            size="sm"
                            variant="outline"
                            className="mt-2 w-full h-7 text-xs"
                            onClick={() => handleGenerateVariation(variation)}
                            disabled={generatingVariationId !== null}
                          >
                            {generatingVariationId === variation.id ? (
                              <>
                                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                                生成中...
                              </>
                            ) : variation.referenceImage ? (
                              <>
                                <RotateCcw className="h-3 w-3 mr-1" />
                                重新生成
                              </>
                            ) : (
                              <>
                                <Wand2 className="h-3 w-3 mr-1" />
                                生成图片
                              </>
                            )}
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Quick add presets */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">快速添加</Label>
              <div className="flex flex-wrap gap-2">
                {VARIATION_PRESETS.map((preset) => {
                  const exists = variations.some(v => v.name === preset.name);
                  return (
                    <Button
                      key={preset.name}
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      onClick={() => handleQuickAdd(preset)}
                      disabled={exists}
                    >
                      {exists ? (
                        <>
                          <Check className="h-3 w-3 mr-1 text-green-500" />
                          {preset.name}
                        </>
                      ) : (
                        <>
                          <Plus className="h-3 w-3 mr-1" />
                          {preset.name}
                        </>
                      )}
                    </Button>
                  );
                })}
              </div>
            </div>

            {/* Custom add form */}
            {showAddForm ? (
              <div className="space-y-3 p-3 border rounded-lg bg-muted/30">
                <Label className="text-sm font-medium">自定义变体</Label>
                <div className="space-y-2">
                  <Input
                    placeholder="变体名称，如：婚纱、披风装"
                    value={newVariationName}
                    onChange={(e) => setNewVariationName(e.target.value)}
                  />
                  <Textarea
                    placeholder="视觉描述（可选），如：elegant wedding dress, white lace..."
                    value={newVariationPrompt}
                    onChange={(e) => setNewVariationPrompt(e.target.value)}
                    className="min-h-[60px]"
                  />
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={handleAddVariation}>
                    <Check className="h-3 w-3 mr-1" />
                    添加
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setShowAddForm(false);
                      setNewVariationName("");
                      setNewVariationPrompt("");
                    }}
                  >
                    <X className="h-3 w-3 mr-1" />
                    取消
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                variant="outline"
                className="w-full"
                onClick={() => setShowAddForm(true)}
              >
                <Plus className="h-4 w-4 mr-2" />
                添加自定义变体
              </Button>
            )}

            {/* Tips */}
            <div className="text-xs text-muted-foreground space-y-1 pt-2 border-t">
              <p>💡 变体生成会参考角色基础定妆照，保持面部特征一致</p>
              <p>💡 建议先生成角色基础图片，再添加变体</p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete variation confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除变体</AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除变体 "{deleteTarget?.name}" 吗？此操作无法撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDeleteVariation}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// Helper: Generate variation image via API
async function generateVariationImage(
  prompt: string,
  apiKey: string,
  referenceImage?: string,
  styleId?: string,
  provider: string = 'memefast'
): Promise<string> {
  const stylePreset = styleId ? getStyleById(styleId) : null;
  const styleTokens = stylePreset?.prompt || 'anime style, professional quality';
  const isRealistic = stylePreset?.category === 'real';

  const fullPrompt = `${prompt}, ${styleTokens}`;
  const negativePrompt = isRealistic
    ? 'blurry, low quality, watermark, text, cropped, partial, anime, cartoon, illustration, drawing, sketch, manga, cel shaded, 2D, animated'
    : 'blurry, low quality, watermark, text, cropped, partial';

  const requestBody: Record<string, unknown> = {
    prompt: fullPrompt,
    negativePrompt,
    aspectRatio: '1:1',
    apiKey,
    provider,
  };

  // Add reference image for consistency
  if (referenceImage) {
    requestBody.referenceImages = [referenceImage];
  }

  const response = await fetch('/api/ai/image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || '图片生成失败');
  }

  const data = await response.json();

  if (data.imageUrl) {
    return data.imageUrl;
  }

  if (data.taskId) {
    return await pollForImage(data.taskId, apiKey, provider);
  }

  throw new Error('无效的API响应');
}

// Helper: Poll for image completion
async function pollForImage(taskId: string, apiKey: string, provider: string = 'memefast'): Promise<string> {
  const maxAttempts = 60;
  const pollInterval = 2000;

  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(resolve => setTimeout(resolve, pollInterval));

    const response = await fetch(
      `/api/ai/task/${taskId}?provider=${provider}&type=image&apiKey=${encodeURIComponent(apiKey)}`
    );

    if (!response.ok) continue;

    const data = await response.json();

    if (data.status === 'completed' && (data.resultUrl || data.result?.url || data.result?.imageUrl)) {
      return data.resultUrl || data.result?.url || data.result?.imageUrl;
    }

    if (data.status === 'failed') {
      throw new Error(data.error || '图片生成失败');
    }
  }

  throw new Error('图片生成超时');
}
