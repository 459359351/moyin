// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/**
 * Shot Generator Service
 * Generates images and videos for individual shots using AI APIs
 */

import type { Shot } from "@/types/script";
import { retryOperation } from "@/lib/utils/retry";
import { delay, RATE_LIMITS } from "@/lib/utils/rate-limiter";

const buildEndpoint = (baseUrl: string, path: string) => {
  const normalized = baseUrl.replace(/\/+$/, '');
  return /\/v\d+$/.test(normalized) ? `${normalized}/${path}` : `${normalized}/v1/${path}`;
};
const SEEDREAM_MODEL_RE = /doubao[-_]?seedream|seedream/i;
const SEEDREAM_AREA_BY_RESOLUTION: Record<'1K' | '2K' | '4K', number> = {
  '1K': 1024 * 1024,
  '2K': 2048 * 2048,
  '4K': 4096 * 4096,
};

function isSeedreamModel(model: string): boolean {
  return SEEDREAM_MODEL_RE.test((model || '').toLowerCase());
}

function toSeedreamSize(
  aspectRatio: '16:9' | '9:16',
  resolution: '1K' | '2K' | '4K'
): string {
  const [w, h] = aspectRatio.split(':').map(Number);
  const ratio = w / h;
  const area = SEEDREAM_AREA_BY_RESOLUTION[resolution];
  let width = Math.round(Math.sqrt(area * ratio));
  let height = Math.round(Math.sqrt(area / ratio));

  if (width > 4096) {
    width = 4096;
    height = Math.max(256, Math.round(width / ratio));
  }
  if (height > 4096) {
    height = 4096;
    width = Math.max(256, Math.round(height * ratio));
  }
  if (width % 2 !== 0) width -= 1;
  if (height % 2 !== 0) height -= 1;

  return `${Math.max(256, width)}x${Math.max(256, height)}`;
}

export interface ShotGenerationConfig {
  apiKey: string;
  provider?: string;
  baseUrl: string;
  model: string;
  aspectRatio?: '16:9' | '9:16';
  styleTokens?: string[];
  referenceImages?: string[]; // Character reference images for consistency
  imageResolution?: '1K' | '2K' | '4K';
  videoResolution?: '480p' | '720p' | '1080p';
}

export interface ShotGenerationResult {
  imageUrl?: string;
  videoUrl?: string;
}

/**
 * Poll task status until completion
 */
async function pollTaskStatus(
  taskId: string,
  apiKey: string,
  baseUrl: string,
  type: 'image' | 'video',
  onProgress?: (progress: number) => void
): Promise<string> {
  const maxAttempts = 120;
  const pollInterval = 2000;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const progress = Math.min(Math.floor((attempt / maxAttempts) * 100), 99);
    onProgress?.(progress);

    try {
      const url = new URL(buildEndpoint(baseUrl, `tasks/${taskId}`));
      url.searchParams.set('_ts', Date.now().toString());

      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Cache-Control': 'no-cache',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to check task status: ${response.status}`);
      }

      const data = await response.json();
      const status = (data.status ?? data.data?.status ?? 'unknown').toString().toLowerCase();

      const statusMap: Record<string, string> = {
        'pending': 'pending',
        'submitted': 'pending',
        'queued': 'pending',
        'processing': 'processing',
        'running': 'processing',
        'in_progress': 'processing',
        'completed': 'completed',
        'succeeded': 'completed',
        'success': 'completed',
        'failed': 'failed',
        'error': 'failed',
      };

      const mappedStatus = statusMap[status] || 'processing';

      if (mappedStatus === 'completed') {
        onProgress?.(100);
        
        let resultUrl: string | undefined;
        if (type === 'image') {
          const images = data.result?.images ?? data.data?.result?.images;
          if (images?.[0]) {
            const urlField = images[0].url;
            resultUrl = Array.isArray(urlField) ? urlField[0] : urlField;
          }
        } else {
          const videos = data.result?.videos ?? data.data?.result?.videos;
          if (videos?.[0]) {
            const urlField = videos[0].url;
            resultUrl = Array.isArray(urlField) ? urlField[0] : urlField;
          }
        }
        resultUrl = resultUrl || data.output_url || data.result_url || data.url;

        if (!resultUrl) {
          throw new Error('Task completed but no URL in result');
        }
        return resultUrl;
      }

      if (mappedStatus === 'failed') {
        const rawError = data.error || data.error_message || data.data?.error;
        throw new Error(rawError || 'Task failed');
      }

      await new Promise(resolve => setTimeout(resolve, pollInterval));
    } catch (error) {
      if (error instanceof Error && 
          (error.message.includes('Task failed') || 
           error.message.includes('no URL'))) {
        throw error;
      }
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }
  }

  throw new Error(`Task ${taskId} timed out`);
}

/**
 * Generate image for a shot
 */
export async function generateShotImage(
  shot: Shot,
  config: ShotGenerationConfig,
  onProgress?: (progress: number) => void
): Promise<string> {
  const { apiKey, baseUrl, model, aspectRatio = '16:9', styleTokens = [], referenceImages = [] } = config;
  const isSeedream = isSeedreamModel(model);

  if (!apiKey) {
    throw new Error('API Key is required');
  }
  if (!baseUrl) {
    throw new Error('Base URL is required');
  }
  if (!model) {
    throw new Error('Model is required');
  }

  // Build prompt from shot data (prefer calibrated imagePrompt from three-tier system)
  let prompt = shot.imagePrompt || shot.visualPrompt || shot.actionSummary;
  
  // Add style tokens
  if (styleTokens.length > 0) {
    prompt = `${styleTokens.join(', ')}, ${prompt}`;
  }

  // Add cinematic quality tokens
  prompt = `cinematic, highly detailed, 8k resolution, professional lighting, ${prompt}`;

  console.log('[ShotGenerator] Generating image for shot:', shot.id, prompt.substring(0, 100));

  const requestData: Record<string, unknown> = {
    model,
    prompt,
    n: 1,
    size: isSeedream ? toSeedreamSize(aspectRatio, config.imageResolution || '2K') : aspectRatio,
  };
  if (isSeedream) {
    requestData.sequential_image_generation = 'disabled';
    requestData.response_format = 'url';
    requestData.watermark = false;
    requestData.stream = false;
  } else {
    requestData.resolution = config.imageResolution || '2K';
  }

  // Add reference images for character consistency
  if (referenceImages.length > 0) {
    requestData.image_urls = referenceImages;
  }

  onProgress?.(10);

  // Use retry wrapper for 429 rate limit handling
  const data = await retryOperation(async () => {
    const response = await fetch(buildEndpoint(baseUrl, 'images/generations'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestData),
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = `API error: ${response.status}`;
      try {
        const errorJson = JSON.parse(errorText);
        errorMessage = errorJson.error?.message || errorJson.message || errorMessage;
      } catch {}
      
      // Create error with status code for retry logic
      const error = new Error(errorMessage) as Error & { status?: number };
      error.status = response.status;
      throw error;
    }

    return response.json();
  }, {
    maxRetries: 3,
    baseDelay: 3000,
  });

  onProgress?.(30);

  // Check for direct URL
  const directUrl = data.data?.[0]?.url || data.url;
  const directB64 = data.data?.[0]?.b64_json || data.b64_json;
  if (directUrl || directB64) {
    onProgress?.(100);
    return directUrl || `data:image/png;base64,${directB64}`;
  }

  // Get task ID and poll
  const taskId = data.data?.[0]?.task_id?.toString() || data.task_id?.toString();
  if (!taskId) {
    throw new Error('No task_id or image URL in response');
  }

  const imageUrl = await pollTaskStatus(taskId, apiKey, baseUrl, 'image', (p) => {
    onProgress?.(30 + Math.floor(p * 0.7));
  });

  return imageUrl;
}

/**
 * Generate video for a shot (image-to-video)
 */
export async function generateShotVideo(
  shot: Shot,
  imageUrl: string,
  config: ShotGenerationConfig,
  onProgress?: (progress: number) => void
): Promise<string> {
  const { apiKey, baseUrl, model, aspectRatio = '16:9', referenceImages = [] } = config;

  if (!apiKey) {
    throw new Error('API Key is required');
  }
  if (!baseUrl) {
    throw new Error('Base URL is required');
  }
  if (!model) {
    throw new Error('Model is required');
  }

  // Build video prompt
  const prompt = shot.videoPrompt || shot.actionSummary;

  console.log('[ShotGenerator] Generating video for shot:', shot.id, prompt.substring(0, 100));

  // Build image_with_roles
  interface ImageWithRole {
    url: string;
    role: 'first_frame' | 'last_frame' | 'reference_image';
  }

  const roles: ImageWithRole[] = [
    { url: imageUrl, role: 'first_frame' }
  ];

  // Add character reference images (max 4)
  const maxRefs = Math.min(referenceImages.length, 4);
  for (let i = 0; i < maxRefs; i++) {
    roles.push({ url: referenceImages[i], role: 'reference_image' });
  }

  const requestBody = {
    model,
    prompt,
    duration: shot.duration || 5,
    aspect_ratio: aspectRatio,
    resolution: config.videoResolution || '480p',
    audio: true,
    camerafixed: false,
    image_with_roles: roles,
  };

  onProgress?.(10);

  // Use retry wrapper for 429 rate limit handling
  const data = await retryOperation(async () => {
    const response = await fetch(buildEndpoint(baseUrl, 'videos/generations'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = `API error: ${response.status}`;
      try {
        const errorJson = JSON.parse(errorText);
        errorMessage = errorJson.error?.message || errorJson.message || errorMessage;
      } catch {}
      
      const error = new Error(errorMessage) as Error & { status?: number };
      error.status = response.status;
      throw error;
    }

    return response.json();
  }, {
    maxRetries: 3,
    baseDelay: 5000,
  });

  onProgress?.(30);

  // Get task ID
  let taskId: string | undefined;
  const dataField = data.data;
  if (Array.isArray(dataField) && dataField.length > 0) {
    taskId = dataField[0].task_id?.toString() || dataField[0].id?.toString();
  } else if (dataField && typeof dataField === 'object') {
    taskId = dataField.task_id?.toString() || dataField.id?.toString();
  } else {
    taskId = data.task_id?.toString() || data.id?.toString();
  }

  if (!taskId) {
    throw new Error('No task ID in response');
  }

  const videoUrl = await pollTaskStatus(taskId, apiKey, baseUrl, 'video', (p) => {
    onProgress?.(30 + Math.floor(p * 0.7));
  });

  return videoUrl;
}

/**
 * Batch generate images for multiple shots
 */
/**
 * Batch generate images for multiple shots with rate limiting
 */
export async function batchGenerateShotImages(
  shots: Shot[],
  config: ShotGenerationConfig,
  onShotProgress: (shotId: string, progress: number) => void,
  onShotComplete: (shotId: string, imageUrl: string) => void,
  onShotError: (shotId: string, error: string) => void
): Promise<void> {
  for (let i = 0; i < shots.length; i++) {
    const shot = shots[i];
    
    // Rate limiting: wait between requests (except first)
    if (i > 0) {
      await delay(RATE_LIMITS.BATCH_ITEM_DELAY);
    }
    
    try {
      const imageUrl = await generateShotImage(
        shot,
        config,
        (progress) => onShotProgress(shot.id, progress)
      );
      onShotComplete(shot.id, imageUrl);
    } catch (error) {
      const err = error as Error;
      onShotError(shot.id, err.message);
    }
  }
}
