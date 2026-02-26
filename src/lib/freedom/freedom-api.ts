// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

/**
 * Freedom Panel API Client
 * Wraps moyin-creator's existing AI infrastructure for single-shot generation
 * Features: smart endpoint routing, retry with exponential backoff
 */

import {
  getAllFeatureConfigs,
  getFeatureConfig,
  getFeatureNotConfiguredMessage,
  type FeatureConfig,
} from '@/lib/ai/feature-router';
import { resolveImageApiFormat } from '@/lib/api-key-manager';
import { uploadBase64Image } from '@/lib/utils/image-upload';
import { isVeoModel, resolveVeoUploadCapability } from '@/lib/freedom/veo-capability';
import { type AIFeature, useAPIConfigStore } from '@/stores/api-config-store';
import { useMediaStore } from '@/stores/media-store';
import { useProjectStore } from '@/stores/project-store';
import { toast } from 'sonner';

// ==================== Types ====================

export interface FreedomImageParams {
  prompt: string;
  model?: string;
  aspectRatio?: string;
  resolution?: string;
  width?: number;
  height?: number;
  negativePrompt?: string;
  extraParams?: Record<string, any>;
}

export type FreedomVideoUploadRole = 'single' | 'first' | 'last' | 'reference';

export interface FreedomVideoUploadFile {
  role: FreedomVideoUploadRole;
  dataUrl: string;
  fileName?: string;
  mimeType?: string;
}

export interface FreedomVideoParams {
  prompt: string;
  model?: string;
  aspectRatio?: string;
  duration?: number;
  resolution?: string;
  enhancePrompt?: boolean;
  enableUpsample?: boolean;
  uploadFiles?: FreedomVideoUploadFile[];
}

export interface GenerationResult {
  url: string;
  taskId?: string;
  mediaId?: string;
}

// ==================== Constants ====================

const IMAGE_POLL_INTERVAL = 2000;
const IMAGE_POLL_MAX_ATTEMPTS = 60;
// Default video polling timeout: 15 minutes (5s * 180 attempts)
const VIDEO_POLL_INTERVAL = 5000;
const VIDEO_POLL_MAX_ATTEMPTS = 180;
const VIDEO_COMPLETED_URL_RETRY_ATTEMPTS = 3;
const VIDEO_COMPLETED_URL_RETRY_INTERVAL = 2000;

// Retry config
const RETRY_MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY = 3000;
const SEEDREAM_MODEL_RE = /doubao[-_]?seedream|seedream/i;
const SEEDREAM_AREA_BY_RESOLUTION: Record<'1K' | '2K' | '4K', number> = {
  '1K': 1024 * 1024,
  '2K': 2048 * 2048,
  '4K': 4096 * 4096,
};

// ==================== Retry Logic ====================

/**
 * Check if an error is retryable (429 rate limit OR 503 service unavailable)
 */
function isRetryableError(error: unknown): boolean {
  if (!error) return false;
  const err = error as any;
  // Check status code
  if (err.status === 429 || err.status === 503) return true;
  if (err.code === 429 || err.code === 503) return true;
  // Check error message
  const message = (err.message || '').toLowerCase();
  return (
    message.includes('429') ||
    message.includes('503') ||
    message.includes('rate') ||
    message.includes('quota') ||
    message.includes('too many requests') ||
    message.includes('service unavailable') ||
    message.includes('temporarily unavailable')
  );
}

/**
 * Retry an operation with exponential backoff for retryable errors
 */
async function freedomRetry<T>(
  operation: () => Promise<T>,
  label: string
): Promise<T> {
  let lastError: Error | undefined;
  for (let attempt = 0; attempt < RETRY_MAX_ATTEMPTS; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;
      if (!isRetryableError(error)) throw error;
      if (attempt < RETRY_MAX_ATTEMPTS - 1) {
        const delay = RETRY_BASE_DELAY * Math.pow(2, attempt);
        console.warn(
          `[Freedom] ${label} hit retryable error, retrying in ${delay}ms... ` +
          `(Attempt ${attempt + 1}/${RETRY_MAX_ATTEMPTS}): ${lastError.message}`
        );
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError;
}

// ==================== Helpers: Endpoint Building ====================

function buildEndpoint(baseUrl: string, path: string): string {
  const normalized = baseUrl.replace(/\/+$/, '');
  return /\/v\d+$/.test(normalized) ? `${normalized}/${path}` : `${normalized}/v1/${path}`;
}

function getRootBaseUrl(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/+$/, '');
  return normalized.replace(/\/v\d+$/, '');
}

function isSeedreamModel(model: string): boolean {
  return SEEDREAM_MODEL_RE.test((model || '').toLowerCase());
}

function normalizeSeedreamResolution(resolution?: string): '1K' | '2K' | '4K' {
  const normalized = (resolution || '2K').toUpperCase();
  if (normalized === '1K' || normalized === '4K') return normalized;
  return '2K';
}

function parseAspectRatio(aspectRatio?: string): { width: number; height: number } | null {
  if (!aspectRatio) return null;
  const parts = aspectRatio.split(':').map(Number);
  if (parts.length !== 2) return null;
  const [width, height] = parts;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  return { width, height };
}

function toSeedreamSize(aspectRatio?: string, resolution?: string, width?: number, height?: number): string {
  if (Number.isFinite(width) && Number.isFinite(height) && (width as number) > 0 && (height as number) > 0) {
    return `${Math.round(width as number)}x${Math.round(height as number)}`;
  }

  const normalizedResolution = normalizeSeedreamResolution(resolution);
  if ((aspectRatio || '1:1') === '1:1') {
    return normalizedResolution;
  }

  const ratio = parseAspectRatio(aspectRatio) || { width: 1, height: 1 };
  const ratioValue = ratio.width / ratio.height;
  const targetArea = SEEDREAM_AREA_BY_RESOLUTION[normalizedResolution];

  let targetWidth = Math.round(Math.sqrt(targetArea * ratioValue));
  let targetHeight = Math.round(Math.sqrt(targetArea / ratioValue));

  if (targetWidth > 4096) {
    targetWidth = 4096;
    targetHeight = Math.max(256, Math.round(targetWidth / ratioValue));
  }
  if (targetHeight > 4096) {
    targetHeight = 4096;
    targetWidth = Math.max(256, Math.round(targetHeight * ratioValue));
  }
  if (targetWidth % 2 !== 0) targetWidth -= 1;
  if (targetHeight % 2 !== 0) targetHeight -= 1;

  return `${Math.max(256, targetWidth)}x${Math.max(256, targetHeight)}`;
}

function pickFeatureConfig(feature: AIFeature, requestedModel?: string): FeatureConfig | null {
  const all = getAllFeatureConfigs(feature);
  if (all.length === 0) return null;
  if (requestedModel) {
    return all.find((c) => c.model === requestedModel) ?? null;
  }
  return getFeatureConfig(feature) ?? all[0];
}

function resolveFreedomFeatureConfig(
  feature: 'freedom_image' | 'freedom_video',
  fallback: 'character_generation' | 'video_generation',
  requestedModel?: string,
): { config: FeatureConfig | null; source: string } {
  const primary = pickFeatureConfig(feature, requestedModel);
  if (primary) return { config: primary, source: feature };

  const fb = pickFeatureConfig(fallback, requestedModel);
  if (fb) return { config: fb, source: `${fallback} (fallback)` };

  return { config: null, source: feature };
}

type FreedomImageRoute = 'midjourney' | 'ideogram' | 'kling_image' | 'openai_chat' | 'openai_images' | 'replicate';

function detectFreedomImageRoute(model: string, endpointTypes?: string[]): FreedomImageRoute {
  const lower = model.toLowerCase();
  const hasEndpoint = (re: RegExp) => (endpointTypes || []).some((t) => re.test(t));

  if (/^mj_/i.test(model) || /midjourney/i.test(model) || /^niji-/i.test(model) || hasEndpoint(/midjourney/i)) {
    return 'midjourney';
  }
  if (/^ideogram_/i.test(model)) {
    return 'ideogram';
  }
  if (/^kling-(image|omni-image)$/i.test(model)) {
    return 'kling_image';
  }

  // Replicate: endpoint type commonly looks like '{org}/{model}'
  if ((endpointTypes || []).some(t => /^[a-z0-9._-]+\/[a-z0-9._-]+$/i.test(t))) {
    return 'replicate';
  }

  const baseRoute = resolveImageApiFormat(endpointTypes, model);
  return baseRoute === 'openai_chat' ? 'openai_chat' : 'openai_images';
}

type FreedomVideoRoute = 'openai_official' | 'unified' | 'volc' | 'wan' | 'kling' | 'replicate';

const FREEDOM_VIDEO_ROUTE_MAP: Record<string, FreedomVideoRoute> = {
  'openai-response': 'unified',
  'omni-video': 'kling',
  'aigc-video': 'unified',
};

function inferFreedomVideoRouteFromEndpointType(endpointTypeRaw: string): FreedomVideoRoute | null {
  const endpointType = endpointTypeRaw.trim().toLowerCase();
  if (!endpointType) return null;

  const direct = FREEDOM_VIDEO_ROUTE_MAP[endpointType];
  if (direct) return direct;

  if (endpointType.includes('sora') || endpointType.includes('/v1/videos')) return 'openai_official';
  if (endpointType.includes('openai') && endpointType.includes('video')) return 'openai_official';

  if (endpointType.includes('kling') || endpointType.includes('omni-video')) return 'kling';

  if (
    endpointType.includes('seedance') ||
    endpointType.includes('doubao') ||
    endpointType.includes('/volc/') ||
    endpointType.includes('volc')
  ) {
    return 'volc';
  }

  if (endpointType.includes('wan') || endpointType.includes('bailian') || endpointType.includes('/ali/')) {
    return 'wan';
  }

  if (endpointType.includes('replicate') || /^[a-z0-9._-]+\/[a-z0-9._-]+$/i.test(endpointType)) {
    return 'replicate';
  }

  if (
    endpointType.includes('video/generations') ||
    endpointType.includes('/v1/video') ||
    endpointType.includes('grok') ||
    endpointType.includes('luma') ||
    endpointType.includes('runway') ||
    endpointType.includes('vidu')
  ) {
    return 'unified';
  }

  return null;
}

function detectFreedomVideoRoute(model: string, endpointTypes?: string[]): FreedomVideoRoute {
  if (endpointTypes && endpointTypes.length > 0) {
    const formats = endpointTypes
      .map(t => inferFreedomVideoRouteFromEndpointType(t))
      .filter((f): f is FreedomVideoRoute => f !== null);

    const priority: FreedomVideoRoute[] = ['openai_official', 'kling', 'volc', 'wan', 'replicate', 'unified'];
    for (const format of priority) {
      if (formats.includes(format)) return format;
    }
  }

  const m = model.toLowerCase();
  if (m.includes('sora-2') || m.includes('openai')) return 'openai_official';
  if (m.includes('kling')) return 'kling';
  if (m.includes('seedance') || m.includes('doubao')) return 'volc';
  if (m.includes('wan')) return 'wan';
  if (m.includes('replicate')) return 'replicate';
  return 'unified';
}

// ==================== Image Generation ====================

export async function generateFreedomImage(
  params: FreedomImageParams
): Promise<GenerationResult> {
  return freedomRetry(() => _generateFreedomImageInner(params), 'Image generation');
}

async function _generateFreedomImageInner(
  params: FreedomImageParams
): Promise<GenerationResult> {
  const { config, source: configSource } = resolveFreedomFeatureConfig(
    'freedom_image',
    'character_generation',
    params.model,
  );
  if (!config) {
    const msg = getFeatureNotConfiguredMessage('character_generation');
    toast.error('自由板块图片生成未配置：请在设置中配置「自由板块-图片」或「图片生成」服务映射');
    throw new Error(msg);
  }
  console.log(`[Freedom] Image config source: ${configSource}`);

  const { apiKey, baseUrl, model: defaultModel } = config;
  // 模型 ID 直接透传：UI 选的就是供应商原始 ID，无需转换
  const model = params.model || defaultModel;
  const normalizedBase = baseUrl.replace(/\/+$/, '');

  // ── Smart Routing: choose endpoint based on model metadata ──
  const endpointTypes = useAPIConfigStore.getState().modelEndpointTypes[model];
  const route = detectFreedomImageRoute(model, endpointTypes);

  console.log('[Freedom] Generating image:', {
    model,
    route,
    endpointTypes,
    prompt: params.prompt.slice(0, 50),
  });
  if (route === 'midjourney') {
    return await generateViaMidjourneyEndpoint(params, model, apiKey, normalizedBase);
  }
  if (route === 'ideogram') {
    return await generateViaIdeogramEndpoint(params, model, apiKey, normalizedBase);
  }
  if (route === 'openai_chat') {
    return await generateViaChatCompletions(params, model, apiKey, normalizedBase);
  }
  if (route === 'kling_image') {
    return await generateViaKlingImagesEndpoint(params, model, apiKey, normalizedBase);
  }
  if (route === 'replicate') {
    return await generateViaReplicateImageEndpoint(params, model, apiKey, normalizedBase);
  }
  return await generateViaImagesEndpoint(params, model, apiKey, normalizedBase);
}

/**
 * Generate image via /v1/chat/completions (for Gemini, GPT-image, etc.)
 */
async function generateViaChatCompletions(
  params: FreedomImageParams,
  model: string,
  apiKey: string,
  baseUrl: string,
): Promise<GenerationResult> {
  const endpoint = buildEndpoint(baseUrl, 'chat/completions');
  const aspectRatio = params.aspectRatio || '1:1';

  const userContent: Array<{ type: string; text?: string }> = [
    { type: 'text', text: `Generate an image with aspect ratio ${aspectRatio}: ${params.prompt}` },
  ];

  const requestBody = {
    model,
    messages: [{ role: 'user', content: userContent }],
    max_tokens: 4096,
  };

  console.log('[Freedom] Submitting via chat completions:', { model, endpoint });

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    let msg = `图片生成 API 错误: ${response.status}`;
    try { const j = JSON.parse(errorText); msg = j.error?.message || msg; } catch {}
    throw new Error(msg);
  }

  const data = await response.json();
  const imageUrl = extractChatCompletionsImage(data);

  if (!imageUrl) {
    throw new Error('未能从聊天响应中提取图片 URL');
  }

  const mediaId = saveToMediaLibrary(imageUrl, params.prompt, 'ai-image');
  return { url: imageUrl, mediaId };
}

/**
 * Extract image URL from chat completions response (multiple formats)
 */
function extractChatCompletionsImage(data: any): string | null {
  const choice = data.choices?.[0];
  if (!choice) return null;

  const message = choice.message;

  // Format 1: content is array with image parts (OpenAI multimodal)
  if (Array.isArray(message?.content)) {
    for (const part of message.content) {
      if (part.type === 'image_url' && part.image_url?.url) {
        return part.image_url.url;
      }
      if (part.type === 'image' && part.image?.url) {
        return part.image.url;
      }
      if (part.type === 'image' && part.data) {
        return `data:image/png;base64,${part.data}`;
      }
    }
  }

  // Format 2: content is string with markdown image link or base64
  if (typeof message?.content === 'string') {
    const mdMatch = message.content.match(/!\[.*?\]\((https?:\/\/[^)]+)\)/);
    if (mdMatch) return mdMatch[1];
    const b64Match = message.content.match(/(data:image\/[^;]+;base64,[A-Za-z0-9+/=]+)/);
    if (b64Match) return b64Match[1];
  }

  return null;
}

/**
 * Generate image via standard /v1/images/generations endpoint
 */
async function generateViaImagesEndpoint(
  params: FreedomImageParams,
  model: string,
  apiKey: string,
  baseUrl: string,
): Promise<GenerationResult> {
  const body: Record<string, any> = {
    prompt: params.prompt,
    model,
  };
  if (isSeedreamModel(model)) {
    body.size = toSeedreamSize(params.aspectRatio, params.resolution, params.width, params.height);
    body.sequential_image_generation = 'disabled';
    body.response_format = 'url';
    body.watermark = false;
    body.stream = false;
    if (params.negativePrompt) body.negative_prompt = params.negativePrompt;
    if (params.extraParams) Object.assign(body, params.extraParams);
    delete body.aspect_ratio;
    delete body.resolution;
    delete body.width;
    delete body.height;
  } else {
    if (params.aspectRatio) body.aspect_ratio = params.aspectRatio;
    if (params.resolution) body.resolution = params.resolution;
    if (params.width) body.width = params.width;
    if (params.height) body.height = params.height;
    if (params.negativePrompt) body.negative_prompt = params.negativePrompt;
    if (params.extraParams) {
      Object.assign(body, params.extraParams);
    }
  }

  const submitUrl = buildEndpoint(baseUrl, 'images/generations');
  const response = await fetch(submitUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Image generation failed: ${response.status} ${errText}`);
  }

  const data = await response.json();

  // Try to get image URL directly
  let imageUrl = extractImageUrl(data);

  // If async task, poll for result
  if (!imageUrl && data.task_id) {
    imageUrl = await pollForResult(
      buildEndpoint(baseUrl, `images/generations/${data.task_id}`),
      apiKey,
      IMAGE_POLL_INTERVAL,
      IMAGE_POLL_MAX_ATTEMPTS
    );
  }

  if (!imageUrl) {
    throw new Error('No image URL in response');
  }

  const mediaId = saveToMediaLibrary(imageUrl, params.prompt, 'ai-image');
  return { url: imageUrl, taskId: data.task_id, mediaId };
}

/**
 * Generate image via Kling's native /kling/v1/images/* endpoints
 * Falls back to standard /v1/images/generations if native endpoint fails
 */
async function generateViaKlingImagesEndpoint(
  params: FreedomImageParams,
  model: string,
  apiKey: string,
  baseUrl: string,
): Promise<GenerationResult> {
  const rootBase = getRootBaseUrl(baseUrl);
  const nativePath = model === 'kling-omni-image'
    ? 'kling/v1/images/omni-image'
    : 'kling/v1/images/generations';

  const body: Record<string, any> = { prompt: params.prompt, model };
  if (params.aspectRatio) body.aspect_ratio = params.aspectRatio;
  if (params.negativePrompt) body.negative_prompt = params.negativePrompt;
  if (params.extraParams) Object.assign(body, params.extraParams);

  let response: Response;
  try {
    response = await fetch(`${rootBase}/${nativePath}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    });
  } catch {
    return generateViaImagesEndpoint(params, model, apiKey, baseUrl);
  }

  if (!response.ok) {
    return generateViaImagesEndpoint(params, model, apiKey, baseUrl);
  }

  const data = await response.json();
  let imageUrl = extractImageUrl(data);

  if (!imageUrl && data.task_id) {
    imageUrl = await pollForResult(
      `${rootBase}/${nativePath}/${data.task_id}`,
      apiKey,
      IMAGE_POLL_INTERVAL,
      IMAGE_POLL_MAX_ATTEMPTS,
    );
  }

  if (!imageUrl) {
    return generateViaImagesEndpoint(params, model, apiKey, baseUrl);
  }

  const mediaId = saveToMediaLibrary(imageUrl, params.prompt, 'ai-image');
  return { url: imageUrl, taskId: data.task_id, mediaId };
}

function toHttpError(prefix: string, status: number, body: string): Error & { status: number } {
  const err = new Error(`${prefix}: ${status} ${body}`) as Error & { status: number };
  err.status = status;
  return err;
}

function buildMidjourneyPrompt(params: FreedomImageParams): string {
  let prompt = params.prompt;
  const extra = params.extraParams || {};
  const aspect = params.aspectRatio;
  const stylization = typeof extra.stylization === 'number' ? extra.stylization : undefined;
  const weirdness = typeof extra.weirdness === 'number' ? extra.weirdness : undefined;

  if (aspect && !/\s--ar\s+\S+/i.test(prompt)) {
    prompt += ` --ar ${aspect}`;
  }
  if (stylization !== undefined && !/\s--s(tylize)?\s+\S+/i.test(prompt)) {
    prompt += ` --s ${stylization}`;
  }
  if (weirdness !== undefined && !/\s--weird\s+\S+/i.test(prompt)) {
    prompt += ` --weird ${weirdness}`;
  }
  return prompt;
}

function mapMidjourneyMode(speed: unknown): string[] | undefined {
  if (typeof speed !== 'string') return undefined;
  const normalized = speed.toLowerCase();
  if (normalized === 'relaxed') return ['RELAX'];
  if (normalized === 'fast') return ['FAST'];
  if (normalized === 'turbo') return ['TURBO'];
  return undefined;
}

async function generateViaMidjourneyEndpoint(
  params: FreedomImageParams,
  model: string,
  apiKey: string,
  baseUrl: string,
): Promise<GenerationResult> {
  const rootBase = getRootBaseUrl(baseUrl);
  const submitUrl = `${rootBase}/mj/submit/imagine`;
  const extra = params.extraParams || {};
  const requestBody: Record<string, any> = {
    prompt: buildMidjourneyPrompt(params),
  };
  const modes = mapMidjourneyMode(extra.speed);
  if (modes) requestBody.accountFilter = { modes };
  if (/niji/i.test(model)) requestBody.botType = 'NIJI_JOURNEY';
  // 垫图：base64Array（图片引导，格式 data:image/png;base64,xxx）
  if (Array.isArray(extra.base64Array) && extra.base64Array.length > 0) {
    requestBody.base64Array = extra.base64Array;
  }

  const submitResp = await fetch(submitUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(requestBody),
  });
  if (!submitResp.ok) {
    throw toHttpError('Midjourney submit failed', submitResp.status, await submitResp.text());
  }

  const submitData = await submitResp.json();
  // MJ API 成功时 code === 1；其他值表示 API 层错误（即使 HTTP 200）
  if (submitData.code !== undefined && submitData.code !== 1) {
    throw new Error(submitData.description || submitData.error || `Midjourney 提交失败 (code=${submitData.code})`);
  }
  const taskId = submitData.result || submitData.task_id || submitData.id;
  if (!taskId) throw new Error('Midjourney 返回空任务 ID');

  const pollUrl = `${rootBase}/mj/task/${taskId}/fetch`;
  for (let i = 0; i < IMAGE_POLL_MAX_ATTEMPTS; i++) {
    await new Promise((r) => setTimeout(r, 2500));
    const pollResp = await fetch(pollUrl, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });
    if (!pollResp.ok) continue;
    const pollData = await pollResp.json();
    const status = String(pollData.status || '').toLowerCase();
    if (status === 'success' || status === 'succeeded' || status === 'completed') {
      const imageUrl =
        pollData.imageUrl ||
        pollData.image_url ||
        pollData.url ||
        pollData.data?.imageUrl ||
        pollData.data?.image_url;
      if (!imageUrl) throw new Error('Midjourney 成功但未返回图片 URL');
      const mediaId = saveToMediaLibrary(imageUrl, params.prompt, 'ai-image');
      return { url: imageUrl, taskId: String(taskId), mediaId };
    }
    if (status === 'failure' || status === 'failed' || status === 'error') {
      throw new Error(pollData.failReason || pollData.message || 'Midjourney 生成失败');
    }
  }

  throw new Error('Midjourney 生成超时');
}

function toIdeogramAspectRatio(model: string, aspectRatio?: string): string | undefined {
  if (!aspectRatio) return undefined;

  // V1/V2 使用 ASPECT_16_9；V3 使用 16x9
  if (/_V_[12](_|$)/i.test(model)) {
    return `ASPECT_${aspectRatio.replace(':', '_')}`;
  }
  return aspectRatio.replace(':', 'x');
}

function toIdeogramRenderSpeed(input: unknown): string | undefined {
  if (typeof input !== 'string') return undefined;
  const normalized = input.toLowerCase();
  if (normalized === 'turbo') return 'TURBO';
  if (normalized === 'quality') return 'QUALITY';
  if (normalized === 'balanced') return 'DEFAULT';
  return input.toUpperCase();
}

/**
 * 从 model 名后缀自动提取 rendering_speed
 * e.g. ideogram_generate_V_3_TURBO → 'TURBO'
 */
function toIdeogramRenderSpeedFromModel(model: string): string | undefined {
  const match = model.match(/_(TURBO|DEFAULT|QUALITY|FLASH)$/i);
  return match ? match[1].toUpperCase() : undefined;
}

async function generateViaIdeogramEndpoint(
  params: FreedomImageParams,
  model: string,
  apiKey: string,
  baseUrl: string,
): Promise<GenerationResult> {
  // Ideogram 原生路径：/ideogram/v1/ideogram-v3/generate（不是 /v1/ideogram-v3/generate）
  const rootBase = getRootBaseUrl(baseUrl);
  const endpoint = `${rootBase}/ideogram/v1/ideogram-v3/generate`;
  const extra = params.extraParams || {};
  const form = new FormData();
  form.append('model', model);
  form.append('prompt', params.prompt);

  const aspect = toIdeogramAspectRatio(model, params.aspectRatio);
  if (aspect) form.append('aspect_ratio', aspect);

  // extraParams 优先；无则从 model 名后缀推断（e.g. ideogram_generate_V_3_TURBO）
  const speed = toIdeogramRenderSpeed(extra.render_speed || extra.rendering_speed)
    ?? toIdeogramRenderSpeedFromModel(model);
  if (speed) form.append('rendering_speed', speed);

  if (typeof extra.style === 'string') form.append('style_type', extra.style.toUpperCase());
  if (typeof params.negativePrompt === 'string' && params.negativePrompt.trim()) {
    form.append('negative_prompt', params.negativePrompt);
  }
  if (typeof extra.num_images === 'number') form.append('num_images', String(extra.num_images));

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
    },
    body: form,
  });

  if (!response.ok) {
    throw toHttpError('Ideogram generate failed', response.status, await response.text());
  }

  const data = await response.json();
  const imageUrl = extractImageUrl(data);
  if (!imageUrl) throw new Error('Ideogram 响应未包含图片 URL');
  const mediaId = saveToMediaLibrary(imageUrl, params.prompt, 'ai-image');
  return { url: imageUrl, mediaId };
}

/**
 * Generate image via Replicate's /replicate/v1/predictions endpoint
 * Request body: { model, input: { prompt, aspect_ratio, ... } }
 * Poll until status === 'succeeded' / 'failed' / 'canceled'
 */
async function generateViaReplicateImageEndpoint(
  params: FreedomImageParams,
  model: string,
  apiKey: string,
  baseUrl: string,
): Promise<GenerationResult> {
  const rootBase = getRootBaseUrl(baseUrl);
  const submitUrl = `${rootBase}/replicate/v1/predictions`;

  const input: Record<string, any> = { prompt: params.prompt };
  if (params.aspectRatio) input.aspect_ratio = params.aspectRatio;
  if (params.resolution) input.resolution = params.resolution;
  if (params.width) input.width = params.width;
  if (params.height) input.height = params.height;
  if (params.negativePrompt) input.negative_prompt = params.negativePrompt;
  if (params.extraParams) Object.assign(input, params.extraParams);

  const submitResp = await fetch(submitUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({ model, input }),
  });
  if (!submitResp.ok) {
    throw toHttpError('Replicate submit failed', submitResp.status, await submitResp.text());
  }

  const submitData = await submitResp.json();
  const directUrl = extractImageUrl(submitData);
  if (directUrl) {
    const mediaId = saveToMediaLibrary(directUrl, params.prompt, 'ai-image');
    return { url: directUrl, mediaId };
  }

  const predictionId = submitData.id;
  if (!predictionId) throw new Error('Replicate 返回空 prediction ID');

  const pollUrl = `${rootBase}/replicate/v1/predictions/${predictionId}`;
  for (let i = 0; i < IMAGE_POLL_MAX_ATTEMPTS; i++) {
    await new Promise(r => setTimeout(r, IMAGE_POLL_INTERVAL));
    const pollResp = await fetch(pollUrl, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });
    if (!pollResp.ok) continue;
    const pollData = await pollResp.json();
    const status = String(pollData.status || '').toLowerCase();
    if (status === 'succeeded') {
      const imageUrl = extractImageUrl(pollData);
      if (!imageUrl) throw new Error('Replicate 成功但未返回图片 URL');
      const mediaId = saveToMediaLibrary(imageUrl, params.prompt, 'ai-image');
      return { url: imageUrl, taskId: String(predictionId), mediaId };
    }
    if (status === 'failed' || status === 'canceled') {
      throw new Error(pollData.error || 'Replicate 图片生成失败');
    }
  }
  throw new Error('Replicate 图片生成超时');
}

// ==================== Video Generation ====================

export async function generateFreedomVideo(
  params: FreedomVideoParams
): Promise<GenerationResult> {
  return freedomRetry(() => _generateFreedomVideoInner(params), 'Video generation');
}

async function _generateFreedomVideoInner(
  params: FreedomVideoParams
): Promise<GenerationResult> {
  const { config, source: configSource } = resolveFreedomFeatureConfig(
    'freedom_video',
    'video_generation',
    params.model,
  );
  if (!config) {
    const msg = getFeatureNotConfiguredMessage('video_generation');
    toast.error('自由板块视频生成未配置：请在设置中配置「自由板块-视频」或「视频生成」服务映射');
    throw new Error(msg);
  }
  console.log(`[Freedom] Video config source: ${configSource}`);

  const { apiKey, baseUrl, model: defaultModel } = config;
  // 模型 ID 直接透传：UI 选的就是供应商原始 ID，无需转换
  const model = params.model || defaultModel;

  const endpointTypes = useAPIConfigStore.getState().modelEndpointTypes[model];
  const route = detectFreedomVideoRoute(model, endpointTypes);
  console.log('[Freedom] Generating video:', {
    model,
    route,
    endpointTypes,
    prompt: params.prompt.slice(0, 50),
  });

  let result: GenerationResult;
  switch (route) {
    case 'openai_official':
      result = await generateVideoViaOpenAIOfficial(params, model, apiKey, baseUrl);
      break;
    case 'volc':
      result = await generateVideoViaVolc(params, model, apiKey, baseUrl);
      break;
    case 'wan':
      result = await generateVideoViaWan(params, model, apiKey, baseUrl);
      break;
    case 'kling':
      result = await generateVideoViaKling(params, model, apiKey, baseUrl);
      break;
    case 'replicate':
      result = await generateVideoViaReplicate(params, model, apiKey, baseUrl);
      break;
    default:
      result = await generateVideoViaUnified(params, model, apiKey, baseUrl);
      break;
  }

  const mediaId = saveToMediaLibrary(result.url, params.prompt, 'ai-video');
  return { ...result, mediaId };
}

/**
 * Convert aspect ratio string to Runway pixel-format ratio (e.g. '16:9' → '1280:720')
 */
function toRunwayRatio(aspectRatio: string): string {
  const map: Record<string, string> = {
    '16:9': '1280:720',
    '9:16': '720:1280',
    '1:1':  '720:720',
    '4:3':  '960:720',
    '3:4':  '720:960',
    '21:9': '2048:880',
  };
  return map[aspectRatio] ?? aspectRatio;
}

function toSoraSize(aspectRatio?: string, resolution?: string): string {
  const isPortrait = aspectRatio === '9:16' || aspectRatio === '3:4';
  const is1080 = (resolution || '').toLowerCase().includes('1080');
  if (is1080) return isPortrait ? '1080x1920' : '1920x1080';
  return isPortrait ? '720x1280' : '1280x720';
}

function toVeoOpenAIVideoSize(aspectRatio?: string): string {
  const isPortrait = aspectRatio === '9:16' || aspectRatio === '3:4';
  return isPortrait ? '9x16' : '16x9';
}

function groupVideoUploadFiles(uploadFiles?: FreedomVideoUploadFile[]) {
  const grouped: {
    single?: FreedomVideoUploadFile;
    first?: FreedomVideoUploadFile;
    last?: FreedomVideoUploadFile;
    references: FreedomVideoUploadFile[];
  } = { references: [] };

  for (const file of uploadFiles || []) {
    if (file.role === 'single' && !grouped.single) grouped.single = file;
    if (file.role === 'first' && !grouped.first) grouped.first = file;
    if (file.role === 'last' && !grouped.last) grouped.last = file;
    if (file.role === 'reference') grouped.references.push(file);
  }

  return grouped;
}

function countVideoUploadFiles(grouped: ReturnType<typeof groupVideoUploadFiles>): number {
  return (
    (grouped.single ? 1 : 0) +
    (grouped.first ? 1 : 0) +
    (grouped.last ? 1 : 0) +
    grouped.references.length
  );
}

function validateVeoVideoUploads(
  model: string,
  endpointTypes: string[] | undefined,
  uploadFiles?: FreedomVideoUploadFile[],
): ReturnType<typeof groupVideoUploadFiles> {
  const capability = resolveVeoUploadCapability(model, endpointTypes);
  const grouped = groupVideoUploadFiles(uploadFiles);
  const total = countVideoUploadFiles(grouped);

  if (!capability.isVeo) return grouped;

  if (capability.mode === 'none') {
    if (total > 0) {
      throw new Error(
        `${model} does not support reference images on this endpoint. Remove uploaded images or switch to a frame/components model.`,
      );
    }
    return grouped;
  }

  if (capability.mode === 'single') {
    const file = grouped.single || grouped.first;
    if (capability.minFiles > 0 && !file) {
      throw new Error(`${model} requires one start frame image.`);
    }
    if (grouped.references.length > 0 || !!grouped.last || (!!grouped.single && !!grouped.first)) {
      throw new Error(`${model} accepts exactly one start frame image. Do not send last/reference images.`);
    }
    return grouped;
  }

  if (capability.mode === 'first_last') {
    if (grouped.references.length > 0 || !!grouped.single) {
      throw new Error(`${model} accepts first/last frame fields only. Use role=first and optional role=last.`);
    }
    if (capability.minFiles > 0 && !grouped.first) {
      throw new Error(`${model} requires a first frame image.`);
    }
    if (!grouped.first && grouped.last) {
      throw new Error(`${model} cannot use a last frame without a first frame.`);
    }
    if (total > capability.maxFiles) {
      throw new Error(`${model} supports up to ${capability.maxFiles} frame images.`);
    }
    return grouped;
  }

  if (capability.mode === 'multi') {
    if (!!grouped.single || !!grouped.first || !!grouped.last) {
      throw new Error(`${model} components mode accepts only role=reference images.`);
    }
    if (grouped.references.length < capability.minFiles) {
      throw new Error(`${model} requires at least ${capability.minFiles} reference image(s).`);
    }
    if (grouped.references.length > capability.maxFiles) {
      throw new Error(`${model} supports up to ${capability.maxFiles} reference image(s).`);
    }
    return grouped;
  }

  return grouped;
}

async function toUploadHttpUrl(file: FreedomVideoUploadFile): Promise<string> {
  if (/^https?:\/\//i.test(file.dataUrl)) return file.dataUrl;
  return uploadBase64Image(file.dataUrl);
}

function dataUrlToBlob(dataUrl: string, mimeHint?: string): Blob {
  const match = dataUrl.match(/^data:(.*?);base64,(.*)$/);
  if (!match) throw new Error('Invalid image input. Expected a base64 data URL.');
  const mime = match[1] || mimeHint || 'image/png';
  const b64 = match[2];
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return new Blob([bytes], { type: mime });
}

async function toUploadBlob(file: FreedomVideoUploadFile): Promise<Blob> {
  if (/^https?:\/\//i.test(file.dataUrl)) {
    const resp = await fetch(file.dataUrl);
    if (!resp.ok) throw new Error(`Failed to download reference image: ${resp.status}`);
    return resp.blob();
  }
  return dataUrlToBlob(file.dataUrl, file.mimeType);
}

async function appendVeoMultipartReferences(
  form: FormData,
  model: string,
  endpointTypes: string[] | undefined,
  uploadFiles?: FreedomVideoUploadFile[],
) {
  const capability = resolveVeoUploadCapability(model, endpointTypes);
  if (!capability.isVeo) return;

  const grouped = validateVeoVideoUploads(model, endpointTypes, uploadFiles);
  const ordered: FreedomVideoUploadFile[] = [];

  if (capability.mode === 'single') {
    const single = grouped.single || grouped.first;
    if (single) ordered.push(single);
  } else if (capability.mode === 'first_last') {
    if (grouped.first) ordered.push(grouped.first);
    if (grouped.last) ordered.push(grouped.last);
  } else if (capability.mode === 'multi') {
    ordered.push(...grouped.references.slice(0, capability.maxFiles));
  }

  for (let i = 0; i < ordered.length; i++) {
    const file = ordered[i];
    const blob = await toUploadBlob(file);
    const fileName = file.fileName || `veo-reference-${i + 1}.png`;
    form.append('input_reference', blob, fileName);
  }
}

async function buildVeoUnifiedVideoBody(
  params: FreedomVideoParams,
  model: string,
  endpointTypes: string[] | undefined,
): Promise<Record<string, any>> {
  const capability = resolveVeoUploadCapability(model, endpointTypes);
  const grouped = validateVeoVideoUploads(model, endpointTypes, params.uploadFiles);
  const body: Record<string, any> = {
    model,
    prompt: params.prompt,
    enhance_prompt: params.enhancePrompt ?? true,
    enable_upsample: params.enableUpsample ?? true,
  };

  if (params.aspectRatio) body.aspect_ratio = params.aspectRatio;

  const images: string[] = [];
  if (capability.mode === 'single') {
    const single = grouped.single || grouped.first;
    if (single) images.push(await toUploadHttpUrl(single));
  } else if (capability.mode === 'first_last') {
    if (grouped.first) images.push(await toUploadHttpUrl(grouped.first));
    if (grouped.last) images.push(await toUploadHttpUrl(grouped.last));
  } else if (capability.mode === 'multi') {
    const refs = grouped.references.slice(0, capability.maxFiles);
    for (const ref of refs) {
      images.push(await toUploadHttpUrl(ref));
    }
  }

  if (images.length > 0) body.images = images;
  return body;
}

async function generateVideoViaOpenAIOfficial(
  params: FreedomVideoParams,
  model: string,
  apiKey: string,
  baseUrl: string,
): Promise<GenerationResult> {
  const endpoint = buildEndpoint(baseUrl, 'videos');
  const endpointTypes = useAPIConfigStore.getState().modelEndpointTypes[model];
  const isVeo = isVeoModel(model);
  const form = new FormData();
  form.append('model', model);
  form.append('prompt', params.prompt);
  form.append('size', isVeo ? toVeoOpenAIVideoSize(params.aspectRatio) : toSoraSize(params.aspectRatio, params.resolution));
  form.append('seconds', String(params.duration || (isVeo ? 8 : 10)));
  if (isVeo) {
    await appendVeoMultipartReferences(form, model, endpointTypes, params.uploadFiles);
  }

  const submitResp = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}` },
    body: form,
  });
  if (!submitResp.ok) {
    throw toHttpError('Sora submit failed', submitResp.status, await submitResp.text());
  }

  const submitData = await submitResp.json();
  const taskId = submitData.id || submitData.video_id;
  const directUrl = extractVideoUrl(submitData);
  if (directUrl) return { url: directUrl, taskId: taskId ? String(taskId) : undefined };
  if (!taskId) throw new Error('Sora 返回空任务 ID');

  const pollUrl = buildEndpoint(baseUrl, `videos/${taskId}`);
  for (let i = 0; i < VIDEO_POLL_MAX_ATTEMPTS; i++) {
    await new Promise((r) => setTimeout(r, VIDEO_POLL_INTERVAL));
    const pollResp = await fetch(pollUrl, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });
    if (!pollResp.ok) continue;
    const pollData = await pollResp.json();
    const status = String(pollData.status || '').toLowerCase();
    if (status === 'completed' || status === 'succeeded' || status === 'success') {
      const videoUrl = extractVideoUrl(pollData) || buildEndpoint(baseUrl, `videos/${taskId}/content`);
      return { url: videoUrl, taskId: String(taskId) };
    }
    if (status === 'failed' || status === 'error') {
      throw new Error(pollData.error?.message || pollData.error || pollData.message || 'Sora 生成失败');
    }
  }

  throw new Error('Sora 生成超时');
}

async function generateVideoViaUnified(
  params: FreedomVideoParams,
  model: string,
  apiKey: string,
  baseUrl: string,
): Promise<GenerationResult> {
  const endpointTypes = useAPIConfigStore.getState().modelEndpointTypes[model];

  let body: Record<string, any>;
  if (isVeoModel(model)) {
    body = await buildVeoUnifiedVideoBody(params, model, endpointTypes);
  } else {
    const isLuma = (endpointTypes || []).some(t => /luma/i.test(t));
    const isRunway = (endpointTypes || []).some(t => /runway/i.test(t));

    body = { model, prompt: params.prompt };
    const metadata: Record<string, any> = {};

    // Duration: Luma requires string with unit ("5s"), other models use number
    if (params.duration) {
      body.duration = isLuma ? `${params.duration}s` : params.duration;
    }

    // AspectRatio: Runway uses metadata.ratio (pixel format); all others use metadata.aspect_ratio
    if (params.aspectRatio) {
      if (isRunway) {
        metadata.ratio = toRunwayRatio(params.aspectRatio);
      } else {
        metadata.aspect_ratio = params.aspectRatio;
      }
    }

    // Resolution: all non-Runway models pass via metadata
    if (params.resolution && !isRunway) {
      metadata.resolution = params.resolution;
    }

    // Image inputs (wan2.6, doubao, luma, vidu, minimax, runway, etc.)
    const grouped = groupVideoUploadFiles(params.uploadFiles);
    if (grouped.single || grouped.first) {
      body.image = await toUploadHttpUrl((grouped.single || grouped.first)!);
    }
    if (grouped.last) {
      metadata.image_end = await toUploadHttpUrl(grouped.last);
    }
    // Reference images: vidu闂傚倸鍊搁崐椋庣矆娓氣偓楠炲鏁撻悩鍐蹭画闂侀潧顦弲娑氬閻熸噴褰掓偐瀹割喖鍓伴梺缁樺笒閻忔岸濡甸崟顖氱闁糕剝銇炴竟鏇㈡⒒娴ｅ憡鎲搁柛鐘茬Ч瀹曪繝宕樺顔兼濡炪倖鍔х粻鎴犵不婵犳碍鐓犻柟闂寸劍濞懷囨煛鐎ｎ亜鈧灝顫忛搹鐟板闁哄洨鍋涢埛澶嬬箾閹惧顣叉い銊ワ工椤?and similar models
    if (grouped.references.length > 0) {
      metadata.reference_images = await Promise.all(
        grouped.references.map(async (f) => ({ url: await toUploadHttpUrl(f) }))
      );
    }

    if (Object.keys(metadata).length > 0) body.metadata = metadata;
  }

  const submitCandidates = [
    buildEndpoint(baseUrl, 'video/generations'),
    buildEndpoint(baseUrl, 'video/create'),
  ];

  let submitData: any = null;
  let submitError: Error | null = null;
  for (const submitUrl of submitCandidates) {
    const resp = await fetch(submitUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });
    if (resp.ok) {
      submitData = await resp.json();
      submitError = null;
      break;
    }

    const text = await resp.text();
    const err = toHttpError('Unified video submit failed', resp.status, text);
    if (resp.status === 404 || resp.status === 405) {
      submitError = err;
      continue;
    }
    throw err;
  }
  if (!submitData) throw submitError || new Error('Unified video submit failed');

  const taskId = submitData.task_id || submitData.id || submitData.request_id;
  const directUrl = extractVideoUrl(submitData);
  if (directUrl) return { url: directUrl, taskId: taskId ? String(taskId) : undefined };
  if (!taskId) throw new Error('缂傚倸鍊搁崐鎼佸磹閹间礁纾归柣鎴ｅГ閸ゅ嫰鏌涢锝嗙缂佹劖顨堥埀顒€绠嶉崕鍗灻洪妸鈺佺婵鍩栭崐鐢告⒒閸喓鈯曢柛鐔哄仱閺屾盯鎮╅崣澶樻＆闂佸搫鏈惄顖炲春閸曨垰绀冪憸蹇曟崲娓氣偓濮婃椽宕崟顒夋闂佺娴烽弫璇差嚕婵犳碍鍋勯柣鎾虫捣閻ｆ娊姊洪崷顓炲妺闁搞劌鐏氶幈銊︽償閵婏箑浠┑鐘诧工閹冲酣銆傞懖鈺冪＜閻庯綆鍋勭粭鎺撱亜椤撶偞澶勭紒缁樼箓椤繈顢楁笟鍥棨闂傚倷绀佸﹢閬嶁€﹂崼婢濆綊鎮滈崜鍨喘婵＄柉顦寸痪鎹愭闇夐柨婵嗘噺閹叉悂鏌ｉ幒妤佹暠濞ｅ洤锕ら—鍐偂鎼粹槅娼庢俊銈囧Х閸嬬偤宕归幐搴㈠弿闁逞屽墴閺屾洟宕煎┑鍥ф濡?ID');

  const pollUrls = [
    buildEndpoint(baseUrl, `video/generations/${taskId}`),
    buildEndpoint(baseUrl, `video/query?id=${taskId}`),
  ];

  for (let i = 0; i < VIDEO_POLL_MAX_ATTEMPTS; i++) {
    await new Promise((r) => setTimeout(r, VIDEO_POLL_INTERVAL));
    for (const pollUrl of pollUrls) {
      const pollResp = await fetch(pollUrl, {
        headers: { 'Authorization': `Bearer ${apiKey}` },
      });
      if (!pollResp.ok) continue;
      const pollData = await pollResp.json();
      const status = getVideoTaskStatus(pollData);
      if (status === 'completed' || status === 'succeeded' || status === 'success') {
        let videoUrl = extractVideoUrl(pollData);
        if (!videoUrl) {
          videoUrl = await refetchVideoUrlAfterCompletion(async () => {
            const followResp = await fetch(pollUrl, {
              headers: { 'Authorization': `Bearer ${apiKey}` },
            });
            if (!followResp.ok) return null;
            return followResp.json();
          });
        }
        if (videoUrl) return { url: videoUrl, taskId: String(taskId) };
        continue;
      }
      if (status === 'failed' || status === 'error' || status === 'cancelled') {
        throw new Error(getVideoTaskErrorMessage(pollData, 'Video generation failed.'));
      }
    }
  }

  throw new Error('Unified video generation timed out before completion.');
}

async function generateVideoViaVolc(
  params: FreedomVideoParams,
  model: string,
  apiKey: string,
  baseUrl: string,
): Promise<GenerationResult> {
  const rootBase = getRootBaseUrl(baseUrl);
  const promptParts = [params.prompt];
  if (params.resolution) promptParts.push(`--rs ${params.resolution.toLowerCase()}`);
  if (params.aspectRatio) promptParts.push(`--rt ${params.aspectRatio}`);
  if (params.duration) promptParts.push(`--dur ${params.duration}`);

  const body = {
    model,
    content: [{ type: 'text', text: promptParts.join(' ') }],
  };

  const submitResp = await fetch(`${rootBase}/volc/v1/contents/generations/tasks`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!submitResp.ok) {
    throw toHttpError('Volc submit failed', submitResp.status, await submitResp.text());
  }

  const submitData = await submitResp.json();
  const taskId = submitData.id;
  if (!taskId) throw new Error('Volc 返回空任务 ID');

  const pollUrl = `${rootBase}/volc/v1/contents/generations/tasks/${taskId}`;
  for (let i = 0; i < VIDEO_POLL_MAX_ATTEMPTS; i++) {
    await new Promise((r) => setTimeout(r, VIDEO_POLL_INTERVAL));
    const pollResp = await fetch(pollUrl, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });
    if (!pollResp.ok) continue;
    const pollData = await pollResp.json();
    const status = String(pollData.status || '').toLowerCase();
    if (status === 'succeeded' || status === 'completed' || status === 'success') {
      const videoUrl = pollData.content?.video_url || extractVideoUrl(pollData);
      if (!videoUrl) throw new Error('Volc 成功但无视频 URL');
      return { url: videoUrl, taskId: String(taskId) };
    }
    if (status === 'failed' || status === 'expired' || status === 'cancelled' || status === 'error') {
      throw new Error(pollData.error?.message || pollData.error || 'Volc 视频生成失败');
    }
  }

  throw new Error('Volc 视频生成超时');
}

async function generateVideoViaWan(
  params: FreedomVideoParams,
  model: string,
  apiKey: string,
  baseUrl: string,
): Promise<GenerationResult> {
  const rootBase = getRootBaseUrl(baseUrl);
  const body: Record<string, any> = {
    model,
    input: { prompt: params.prompt },
    parameters: {
      resolution: (params.resolution || '720P').toUpperCase(),
      prompt_extend: true,
      audio: true,
    },
  };
  if (params.duration) body.parameters.duration = Math.max(3, Math.min(10, params.duration));

  const submitResp = await fetch(
    `${rootBase}/ali/bailian/api/v1/services/aigc/video-generation/video-synthesis`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    },
  );
  if (!submitResp.ok) {
    throw toHttpError('Wan submit failed', submitResp.status, await submitResp.text());
  }

  const submitData = await submitResp.json();
  const taskId = submitData.output?.task_id;
  if (!taskId) throw new Error('Wan 返回空任务 ID');

  const pollUrl = `${rootBase}/alibailian/api/v1/tasks/${taskId}`;
  for (let i = 0; i < VIDEO_POLL_MAX_ATTEMPTS; i++) {
    await new Promise((r) => setTimeout(r, VIDEO_POLL_INTERVAL));
    const pollResp = await fetch(pollUrl, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });
    if (!pollResp.ok) continue;
    const pollData = await pollResp.json();
    const status = String(pollData.output?.task_status || '').toUpperCase();
    if (status === 'SUCCEEDED' || status === 'COMPLETED') {
      const videoUrl = pollData.output?.video_url || extractVideoUrl(pollData);
      if (!videoUrl) throw new Error('Wan 成功但无视频 URL');
      return { url: videoUrl, taskId: String(taskId) };
    }
    if (status === 'FAILED' || status === 'ERROR' || status === 'CANCELLED') {
      throw new Error(pollData.output?.message || pollData.output?.error || 'Wan 视频生成失败');
    }
  }

  throw new Error('Wan 视频生成超时');
}

// Native Kling endpoint paths (relative to /kling/v1/videos/)
// kling-video is handled dynamically: text2video vs image2video based on uploads
const KLING_VIDEO_PATH_MAP: Record<string, string> = {
  'kling-omni-video': 'omni-video',
  'kling-video-extend': 'video-extend',
  'kling-motion-control': 'motion-control',
  'kling-multi-elements': 'multi-elements',
  'kling-avatar-image2video': 'avatar/image2video',
  'kling-advanced-lip-sync': 'advanced-lip-sync',
  'kling-effects': 'effects',
};

async function generateVideoViaKling(
  params: FreedomVideoParams,
  model: string,
  apiKey: string,
  baseUrl: string,
): Promise<GenerationResult> {
  const rootBase = getRootBaseUrl(baseUrl);
  const uploads = params.uploadFiles || [];
  const firstFrame = uploads.find((f) => f.role === 'single' || f.role === 'first');
  const lastFrame = uploads.find((f) => f.role === 'last');

  // Determine the endpoint path
  // Specialized models have a fixed path; all kling-video variants (kling-v2-1-master,
  // kling-v2-6-pro, kling-v3-0-pro, etc.) fall through to text2video / image2video.
  let endpointPath: string;
  const specialPath = KLING_VIDEO_PATH_MAP[model];
  if (specialPath) {
    endpointPath = specialPath;
  } else {
    endpointPath = firstFrame ? 'image2video' : 'text2video';
  }

  const body: Record<string, any> = {
    model_name: model,
    prompt: params.prompt,
    aspect_ratio: params.aspectRatio || '16:9',
    duration: String(params.duration ? Math.min(10, Math.max(5, params.duration)) : 5),
    mode: 'std',
  };

  // Attach image URLs for image-based endpoints
  if (endpointPath === 'image2video' && firstFrame) {
    body.image_url = await toUploadHttpUrl(firstFrame);
    if (lastFrame) body.tail_image_url = await toUploadHttpUrl(lastFrame);
  } else if (endpointPath === 'avatar/image2video' && firstFrame) {
    body.image_url = await toUploadHttpUrl(firstFrame);
  }

  const submitUrl = `${rootBase}/kling/v1/videos/${endpointPath}`;
  const submitResp = await fetch(submitUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!submitResp.ok) {
    throw toHttpError('Kling submit failed', submitResp.status, await submitResp.text());
  }

  const submitData = await submitResp.json();
  const taskId = submitData.data?.task_id;
  if (!taskId) throw new Error('Kling 返回空任务 ID');

  // Poll URL mirrors the submit path: GET /kling/v1/videos/{path}/{task_id}
  const pollUrl = `${rootBase}/kling/v1/videos/${endpointPath}/${taskId}`;
  for (let i = 0; i < VIDEO_POLL_MAX_ATTEMPTS; i++) {
    await new Promise((r) => setTimeout(r, VIDEO_POLL_INTERVAL));
    const pollResp = await fetch(pollUrl, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });
    if (!pollResp.ok) continue;
    const pollData = await pollResp.json();
    const status = String(pollData.data?.task_status || '').toLowerCase();
    if (status === 'succeed' || status === 'success' || status === 'completed') {
      const videoUrl =
        pollData.data?.task_result?.videos?.[0]?.url ||
        pollData.data?.task_result?.video_url ||
        extractVideoUrl(pollData);
      if (!videoUrl) throw new Error('Kling 成功但无视频 URL');
      return { url: videoUrl, taskId: String(taskId) };
    }
    if (status === 'failed' || status === 'error') {
      throw new Error(pollData.data?.task_status_msg || pollData.message || 'Kling 视频生成失败');
    }
  }

  throw new Error('Kling 视频生成超时');
}

/**
 * Generate video via Replicate's /replicate/v1/predictions endpoint
 * Request body: { model, input: { prompt, aspect_ratio, ... } }
 * Poll until status === 'succeeded' / 'failed' / 'canceled'
 */
async function generateVideoViaReplicate(
  params: FreedomVideoParams,
  model: string,
  apiKey: string,
  baseUrl: string,
): Promise<GenerationResult> {
  const rootBase = getRootBaseUrl(baseUrl);
  const submitUrl = `${rootBase}/replicate/v1/predictions`;

  const input: Record<string, any> = { prompt: params.prompt };
  if (params.aspectRatio) input.aspect_ratio = params.aspectRatio;
  if (params.duration) input.duration = params.duration;
  if (params.resolution) input.resolution = params.resolution;

  // Image-to-video: attach upload files inside input
  const grouped = groupVideoUploadFiles(params.uploadFiles);
  const primaryFile = grouped.single || grouped.first;
  if (primaryFile) input.image = await toUploadHttpUrl(primaryFile);
  if (grouped.last) input.tail_image = await toUploadHttpUrl(grouped.last);

  const submitResp = await fetch(submitUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({ model, input }),
  });
  if (!submitResp.ok) {
    throw toHttpError('Replicate video submit failed', submitResp.status, await submitResp.text());
  }

  const submitData = await submitResp.json();
  const directUrl = extractVideoUrl(submitData);
  if (directUrl) return { url: directUrl };

  const predictionId = submitData.id;
  if (!predictionId) throw new Error('Replicate 返回空 prediction ID');

  const pollUrl = `${rootBase}/replicate/v1/predictions/${predictionId}`;
  for (let i = 0; i < VIDEO_POLL_MAX_ATTEMPTS; i++) {
    await new Promise(r => setTimeout(r, VIDEO_POLL_INTERVAL));
    const pollResp = await fetch(pollUrl, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });
    if (!pollResp.ok) continue;
    const pollData = await pollResp.json();
    const status = String(pollData.status || '').toLowerCase();
    if (status === 'succeeded') {
      const videoUrl = extractVideoUrl(pollData);
      if (!videoUrl) throw new Error('Replicate 成功但未返回视频 URL');
      return { url: videoUrl, taskId: String(predictionId) };
    }
    if (status === 'failed' || status === 'canceled') {
      throw new Error(pollData.error || 'Replicate 视频生成失败');
    }
  }
  throw new Error('Replicate 视频生成超时');
}

// ==================== Helpers ====================

function extractImageUrl(data: any): string | null {
  // Handle multiple response formats
  if (data.data?.[0]?.url) return data.data[0].url;
  if (data.data?.[0]?.b64_json) return `data:image/png;base64,${data.data[0].b64_json}`;
  if (data.url) return data.url;
  if (data.output?.url) return data.output.url;
  // Replicate: output as direct string URL or array of URLs
  if (typeof data.output === 'string' && data.output.startsWith('http')) return data.output;
  if (Array.isArray(data.output) && typeof data.output[0] === 'string') return data.output[0];
  if (data.outputs?.[0]) return data.outputs[0];
  // Chat completions format
  if (data.choices?.[0]?.message?.content) {
    const content = data.choices[0].message.content;
    const mdMatch = content.match(/!\[.*?\]\((https?:\/\/[^)]+)\)/);
    if (mdMatch) return mdMatch[1];
    if (content.startsWith('http')) return content.trim();
  }
  return null;
}

function extractVideoUrl(data: any): string | null {
  if (data.data?.[0]?.url) return data.data[0].url;
  if (data.url) return data.url;
  if (data.output?.url) return data.output.url;
  // Replicate: output as direct string URL or array of URLs (minimax/video-01, etc.)
  if (typeof data.output === 'string' && data.output.startsWith('http')) return data.output;
  if (Array.isArray(data.output) && typeof data.output[0] === 'string') return data.output[0];
  if (data.outputs?.[0]) return data.outputs[0];
  if (data.video_url) return data.video_url;
  if (data.detail?.video_url) return data.detail.video_url;
  if (data.detail?.upsample_video_url) return data.detail.upsample_video_url;
  if (data.detail?.output?.video_url) return data.detail.output.video_url;
  if (data.response?.url) return data.response.url;  // doubao, jimeng, grok, wan2.6
  return null;
}

function getVideoTaskStatus(data: any): string {
  return String(
    data?.status ??
      data?.detail?.status ??
      data?.state ??
      data?.detail?.state ??
      data?.data?.status ??
      '',
  ).toLowerCase();
}

function getVideoTaskErrorMessage(data: any, fallback: string = 'Video generation failed.'): string {
  const candidates = [
    data?.error?.message,
    data?.error,
    data?.message,
    data?.error_message,
    data?.detail?.error?.message,
    data?.detail?.error,
    data?.detail?.message,
    data?.detail?.error_message,
    data?.detail?.video_generation_error,
  ];

  for (const item of candidates) {
    if (typeof item === 'string' && item.trim()) return item;
    if (item && typeof item === 'object') return JSON.stringify(item);
  }

  return fallback;
}

async function refetchVideoUrlAfterCompletion(
  requestStatus: () => Promise<any>,
): Promise<string | null> {
  for (let i = 0; i < VIDEO_COMPLETED_URL_RETRY_ATTEMPTS; i++) {
    await new Promise((resolve) => setTimeout(resolve, VIDEO_COMPLETED_URL_RETRY_INTERVAL));
    try {
      const data = await requestStatus();
      if (!data) continue;

      const videoUrl = extractVideoUrl(data);
      if (videoUrl) return videoUrl;

      const status = getVideoTaskStatus(data);
      if (status === 'failed' || status === 'error' || status === 'cancelled') {
        throw new Error(getVideoTaskErrorMessage(data));
      }
    } catch (error) {
      if (error instanceof Error) throw error;
    }
  }
  return null;
}

async function pollForResult(
  pollUrl: string,
  apiKey: string,
  interval: number,
  maxAttempts: number
): Promise<string | null> {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(resolve => setTimeout(resolve, interval));

    try {
      const response = await fetch(pollUrl, {
        headers: { 'Authorization': `Bearer ${apiKey}` },
      });

      if (!response.ok) continue;

      const data = await response.json();
      const status = getVideoTaskStatus(data);

      // Check completion - triple status normalization from Higgsfield
      if (status === 'completed' || status === 'succeeded' || status === 'success') {
        return extractImageUrl(data) || extractVideoUrl(data);
      }

      // Check failure
      if (status === 'failed' || status === 'error' || status === 'cancelled') {
        throw new Error(`Generation failed: ${getVideoTaskErrorMessage(data, status)}`);
      }

      // Still processing
      console.log(`[Freedom] Polling attempt ${i + 1}/${maxAttempts}, status: ${status}`);
    } catch (err: any) {
      if (err.message?.startsWith('Generation failed')) throw err;
      console.warn(`[Freedom] Poll error (attempt ${i + 1}):`, err.message);
    }
  }

  return null;
}

function saveToMediaLibrary(
  url: string,
  prompt: string,
  source: 'ai-image' | 'ai-video'
): string | undefined {
  try {
    const mediaStore = useMediaStore.getState();
    const projectId = useProjectStore.getState().activeProjectId;
    const name = prompt.slice(0, 30).replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '_') || 'freedom';
    const type = source === 'ai-image' ? 'image' : 'video';
    
    const mediaId = mediaStore.addMediaFromUrl({
      url,
      name: `${name}_${Date.now()}`,
      type: type as any,
      source,
      projectId: projectId || undefined,
    });

    return mediaId;
  } catch (err) {
    console.warn('[Freedom] Failed to save to media library:', err);
    return undefined;
  }
}
