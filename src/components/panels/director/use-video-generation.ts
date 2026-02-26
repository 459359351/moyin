// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
import { getFeatureConfig } from "@/lib/ai/feature-router";
import { saveVideoToLocal } from "@/lib/image-storage";
import { normalizeUrl } from "./use-image-generation";
import { useAPIConfigStore } from "@/stores/api-config-store";
import { isVeoModel, resolveVeoUploadCapability } from "@/lib/freedom/veo-capability";

// Default video polling timeout: 15 minutes (5s * 180 attempts)
const VIDEO_POLL_INTERVAL_MS = 5000;
const VIDEO_POLL_MAX_ATTEMPTS = 180;
const VIDEO_COMPLETED_URL_RETRY_ATTEMPTS = 3;
const VIDEO_COMPLETED_URL_RETRY_INTERVAL_MS = 2000;

function buildEndpoint(baseUrl: string, path: string): string {
  const normalized = baseUrl.replace(/\/+$/, '');
  return /\/v\d+$/.test(normalized) ? `${normalized}/${path}` : `${normalized}/v1/${path}`;
}

function getRootBaseUrl(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/+$/, '');
  return normalized.replace(/\/v\d+$/, '');
}

// ==================== Content Moderation ====================

/**
 * Keywords indicating content moderation errors
 * Based on ScriptAgent's CONTENT_MODERATION_KEYWORDS
 */
const CONTENT_MODERATION_KEYWORDS = [
  'moderation',
  'authentication',
  'content_sensitive',
  'violation',
  'sensitive',
  'policy',
  'refused',
  'rejected',
  'inappropriate',
  'blocked',
  'review',
  'prohibited',
  'not_allowed',
  'unsafe',
  'cn_moderation',
  'cn_violation',
  'cn_sensitive',
  'cn_prohibited',
  'cn_rejected',
  'cn_non_compliant',
] as const;

/**
 * Check if an error is related to content moderation
 * @param error - Error message or error object
 * @returns true if it's a moderation error
 */
export function isContentModerationError(error: string | Error | unknown): boolean {
  const errorStr = error instanceof Error
    ? error.message.toLowerCase()
    : String(error).toLowerCase();

  return CONTENT_MODERATION_KEYWORDS.some(keyword => 
    errorStr.includes(keyword.toLowerCase())
  );
}

// Get API configuration for video generation
export function getVideoApiConfig() {
  const featureConfig = getFeatureConfig('video_generation');
  if (!featureConfig) {
    return null;
  }
  
  const keyManager = featureConfig.keyManager;
  const apiKey = keyManager.getCurrentKey() || '';
  const platform = featureConfig.platform;
  const model = featureConfig.models?.[0];
  if (!model) {
    return null;
  }
  const videoBaseUrl = featureConfig.baseUrl?.replace(/\/+$/, '');
  if (!videoBaseUrl) {
    return null;
  }
  
  return {
    apiKey,
    keyManager,
    platform,
    model,
    videoBaseUrl,
  };
}

// Convert local/base64 image to HTTP URL for API
export async function convertToHttpUrl(rawUrl: unknown): Promise<string> {
  const url = typeof rawUrl === 'string' ? rawUrl : (Array.isArray(rawUrl) ? rawUrl[0] : '');
  if (!url) {
    console.warn('[VideoGen] convertToHttpUrl received invalid url:', rawUrl);
    return '';
  }

  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }

  const { uploadToImageHost, isImageHostConfigured } = await import('@/lib/image-host');
  if (!isImageHostConfigured()) {
    throw new Error('Image host is not configured; cannot upload local/base64 image.');
  }

  let base64 = url;
  if (url.startsWith('local-image://')) {
    base64 = await normalizeUrl(url);
  }

  if (!base64.startsWith('data:image/')) {
    throw new Error('Unsupported image url format for upload.');
  }

  const result = await uploadToImageHost(base64);
  if (!result.success || !result.url) {
    throw new Error(result.error || 'Image host upload failed');
  }

  return result.url;
}

export async function buildImageWithRoles(
  firstFrameUrl?: string,
  lastFrameUrl?: string,
): Promise<Array<{ url: string; role: 'first_frame' | 'last_frame' }>> {
  const imageWithRoles: Array<{ url: string; role: 'first_frame' | 'last_frame' }> = [];

  const normalizedFirstFrame = typeof firstFrameUrl === 'string' ? firstFrameUrl.trim() : '';
  if (normalizedFirstFrame) {
    const firstFrameConverted = await convertToHttpUrl(normalizedFirstFrame);
    if (firstFrameConverted) {
      imageWithRoles.push({ url: firstFrameConverted, role: 'first_frame' });
    }
  }

  const normalizedLastFrame = typeof lastFrameUrl === 'string' ? lastFrameUrl.trim() : '';
  if (normalizedLastFrame) {
    const lastFrameConverted = await convertToHttpUrl(normalizedLastFrame);
    if (lastFrameConverted) {
      imageWithRoles.push({ url: lastFrameConverted, role: 'last_frame' });
    }
  }

  return imageWithRoles;
}

type VideoApiFormat = 'openai_official' | 'unified' | 'volc' | 'wan' | 'kling' | 'replicate';

const VIDEO_FORMAT_MAP: Record<string, VideoApiFormat> = {
  'openai-response': 'unified',
  'omni-video': 'kling',
  'aigc-video': 'unified',
};

function inferVideoApiFormatFromEndpointType(endpointTypeRaw: string): VideoApiFormat | null {
  const endpointType = endpointTypeRaw.trim().toLowerCase();
  if (!endpointType) return null;

  const direct = VIDEO_FORMAT_MAP[endpointType];
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

function detectVideoApiFormat(model: string): VideoApiFormat {
  const endpointTypes = useAPIConfigStore.getState().modelEndpointTypes[model];
  if (endpointTypes && endpointTypes.length > 0) {
    const formats = endpointTypes
      .map(t => inferVideoApiFormatFromEndpointType(t))
      .filter((f): f is VideoApiFormat => f !== null);

    const priority: VideoApiFormat[] = ['openai_official', 'kling', 'volc', 'wan', 'replicate', 'unified'];
    for (const format of priority) {
      if (formats.includes(format)) {
        console.log(`[VideoGen] Metadata-driven routing: ${model} -> ${format}`, endpointTypes);
        return format;
      }
    }

    console.warn(`[VideoGen] Unknown endpoint types for ${model}:`, endpointTypes, 'fallback to name-based');
  }

  const m = model.toLowerCase();
  if (m.includes('sora-2') || m.includes('openai')) return 'openai_official';
  if (m.includes('kling')) return 'kling';
  if (m.includes('seedance') || m.includes('doubao')) return 'volc';
  if (m.includes('wan')) return 'wan';
  if (m.includes('replicate')) return 'replicate';
  return 'unified';
}

function handleVideoSubmitError(
  status: number,
  errorText: string,
  keyManager?: { handleError: (status: number) => boolean },
): never {
  if (keyManager?.handleError(status)) {
    console.log('[VideoGen] Rotated to next API key due to error', status);
  }

  let errorMessage = `Video request failed with status ${status}`;
  try {
    const errorJson = JSON.parse(errorText);
    errorMessage = errorJson.error?.message || errorJson.message || errorMessage;
  } catch {
    // ignore JSON parse errors for plain text responses
  }

  if (status === 401 || status === 403) throw new Error('API key is invalid or unauthorized.');
  if (status === 429) throw new Error('Rate limit reached. Please retry later.');
  throw new Error(errorMessage);
}

function extractVideoUrl(data: any): string | null {
  const candidates = [
    data?.video_url,
    data?.url,
    data?.output?.video_url,
    data?.output?.url,
    data?.result?.video_url,
    data?.result?.url,
    data?.data?.video_url,
    data?.data?.url,
    data?.detail?.video_url,
    data?.detail?.upsample_video_url,
    data?.detail?.output?.video_url,
  ];

  for (const item of candidates) {
    const normalized = normalizeUrl(item);
    if (normalized) return normalized;
  }

  if (Array.isArray(data?.output) && data.output.length > 0) {
    for (const item of data.output) {
      const normalized = normalizeUrl(item?.url || item?.video_url);
      if (normalized) return normalized;
    }
  }

  if (Array.isArray(data?.videos) && data.videos.length > 0) {
    for (const item of data.videos) {
      const normalized = normalizeUrl(item?.url || item?.video_url);
      if (normalized) return normalized;
    }
  }

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
    await sleep(VIDEO_COMPLETED_URL_RETRY_INTERVAL_MS);
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

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function ensureMinImageSize(imageUrl: string, minDimension: number = 300): Promise<string> {
  try {
    const img = document.createElement('img');
    img.crossOrigin = 'anonymous';
    const loaded = await new Promise<HTMLImageElement>((resolve, reject) => {
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = imageUrl;
    });

    if (loaded.width >= minDimension && loaded.height >= minDimension) {
      return imageUrl;
    }

    const scale = Math.max(minDimension / loaded.width, minDimension / loaded.height);
    const targetWidth = Math.ceil(loaded.width * scale);
    const targetHeight = Math.ceil(loaded.height * scale);

    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return imageUrl;

    ctx.drawImage(loaded, 0, 0, targetWidth, targetHeight);
    const resized = canvas.toDataURL('image/png');
    return await convertToHttpUrl(resized);
  } catch (e) {
    console.warn('[VideoGen] ensureMinImageSize failed, using original:', e);
    return imageUrl;
  }
}

function toRunwayRatio(aspectRatio: string): string {
  const map: Record<string, string> = {
    '16:9': '1280:720',
    '9:16': '720:1280',
    '4:3': '1024:768',
    '3:4': '768:1024',
    '1:1': '1024:1024',
  };
  return map[aspectRatio] || '1280:720';
}

async function callUnifiedVideoApi(
  apiKey: string,
  prompt: string,
  baseUrl: string,
  model: string,
  aspectRatio: string,
  imageWithRoles: Array<{ url: string; role: 'first_frame' | 'last_frame' }>,
  videoResolution?: string,
  duration?: number,
  onProgress?: (progress: number) => void,
  keyManager?: { handleError: (status: number) => boolean },
): Promise<string> {
  const isVeo = isVeoModel(model);
  const firstFrame = imageWithRoles.find((img) => img.role === 'first_frame') || imageWithRoles[0];
  const lastFrame = imageWithRoles.find((img) => img.role === 'last_frame');

  const body: Record<string, unknown> = {
    model,
    prompt,
  };

  if (isVeo) {
    body.enhance_prompt = true;
    body.enable_upsample = true;
    body.aspect_ratio = aspectRatio;

    const images: string[] = [];
    if (firstFrame?.url) images.push(firstFrame.url);
    if (lastFrame?.url) images.push(lastFrame.url);
    if (images.length > 0) body.images = images;
  } else {
    const metadata: Record<string, unknown> = {};
    if (duration) metadata.duration = duration;

    const m = model.toLowerCase();
    const isRunway = m.includes('runway') || m.includes('gen4') || m.includes('gen-4');

    if (isRunway) {
      metadata.ratio = toRunwayRatio(aspectRatio);
      metadata.duration = duration || 5;
      metadata.resolution = videoResolution || '720p';
      metadata.watermark = false;
    } else {
      metadata.aspect_ratio = aspectRatio;
      if (videoResolution) metadata.resolution = videoResolution;
    }

    if (firstFrame?.url) body.image = firstFrame.url;
    if (lastFrame?.url) metadata.image_end = lastFrame.url;
    if (Object.keys(metadata).length > 0) body.metadata = metadata;
  }

  const submitUrls = [
    buildEndpoint(baseUrl, 'video/generations'),
    buildEndpoint(baseUrl, 'video/create'),
  ];

  let submitData: any = null;
  let submitError: Error | null = null;

  for (const submitUrl of submitUrls) {
    const resp = await fetch(submitUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (resp.ok) {
      submitData = await resp.json();
      submitError = null;
      break;
    }

    const errorText = await resp.text();
    if (resp.status === 404 || resp.status === 405) {
      submitError = new Error(`Video API endpoint not available (${resp.status}).`);
      continue;
    }

    handleVideoSubmitError(resp.status, errorText, keyManager);
  }

  if (!submitData) throw submitError || new Error('Video submit failed on all endpoints.');

  const directUrl = extractVideoUrl(submitData);
  if (directUrl) return directUrl;

  const taskId = (submitData.task_id || submitData.id || submitData.request_id)?.toString();
  if (!taskId) throw new Error('Video task id is missing from submit response.');

  const pollUrls = [
    buildEndpoint(baseUrl, `video/generations/${taskId}`),
    buildEndpoint(baseUrl, `video/query?id=${encodeURIComponent(taskId)}`),
  ];

  for (let attempt = 0; attempt < VIDEO_POLL_MAX_ATTEMPTS; attempt++) {
    onProgress?.(Math.min(20 + Math.floor((attempt / VIDEO_POLL_MAX_ATTEMPTS) * 80), 99));
    await sleep(VIDEO_POLL_INTERVAL_MS);

    for (const pollUrl of pollUrls) {
      const statusResponse = await fetch(pollUrl, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
      });

      if (!statusResponse.ok) continue;

      const statusData = await statusResponse.json();
      const status = getVideoTaskStatus(statusData);

      if (status === 'completed' || status === 'succeeded' || status === 'success') {
        let videoUrl = extractVideoUrl(statusData);
        if (!videoUrl) {
          videoUrl = await refetchVideoUrlAfterCompletion(async () => {
            const followResp = await fetch(pollUrl, {
              method: 'GET',
              headers: {
                'Accept': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
              },
            });
            if (!followResp.ok) return null;
            return followResp.json();
          });
        }
        if (videoUrl) return videoUrl;
        continue;
      }

      if (status === 'failed' || status === 'error' || status === 'cancelled') {
        throw new Error(getVideoTaskErrorMessage(statusData));
      }
    }
  }

  throw new Error('Video generation timed out.');
}

// Call video generation API
export async function callVideoGenerationApi(
  apiKey: string,
  prompt: string,
  duration: number,
  aspectRatio: string,
  imageWithRoles: Array<{ url: string; role: 'first_frame' | 'last_frame' }>,
  onProgress?: (progress: number) => void,
  keyManager?: { handleError: (status: number) => boolean; getAvailableKeyCount: () => number; getTotalKeyCount: () => number },
  platform?: string,
  videoResolution?: '480p' | '720p' | '1080p',
  videoRefs?: string[],
  audioRefs?: string[],
  enableAudio?: boolean,
  cameraFixed?: boolean,
): Promise<string> {
  const featureConfig = getFeatureConfig('video_generation');
  const resolvedPlatform = platform || featureConfig?.platform;
  if (!resolvedPlatform) {
    throw new Error('Video generation platform is not configured.');
  }

  const model = featureConfig?.models?.[0];
  if (!model) {
    throw new Error('Video model is not configured.');
  }

  const videoBaseUrl = featureConfig?.baseUrl?.replace(/\/+$/, '');
  if (!videoBaseUrl) {
    throw new Error('Video API base URL is not configured.');
  }

  const processedImages = await Promise.all(
    imageWithRoles.map(async (img) => ({
      ...img,
      url: await ensureMinImageSize(img.url),
    })),
  );

  const format = detectVideoApiFormat(model);
  console.log('[VideoGen] Detected API format:', { model, format, platform: resolvedPlatform });

  switch (format) {
    case 'openai_official':
      return callOpenAIOfficialVideoApi(apiKey, prompt, videoBaseUrl, model, aspectRatio, processedImages, duration, videoResolution, onProgress, keyManager);
    case 'volc':
      return callVolcVideoApi(apiKey, prompt, videoBaseUrl, model, aspectRatio, processedImages, videoResolution, duration, cameraFixed, onProgress, keyManager, videoRefs, audioRefs);
    case 'wan':
      return callWanVideoApi(apiKey, prompt, videoBaseUrl, model, processedImages, videoResolution, duration, enableAudio, onProgress, keyManager);
    case 'kling':
      return callKlingVideoApi(apiKey, prompt, videoBaseUrl, model, aspectRatio, processedImages, duration, onProgress, keyManager);
    case 'replicate':
      return callReplicateVideoApi(apiKey, prompt, videoBaseUrl, model, aspectRatio, processedImages, duration, videoResolution, onProgress, keyManager);
    default:
      return callUnifiedVideoApi(apiKey, prompt, videoBaseUrl, model, aspectRatio, processedImages, videoResolution, duration, onProgress, keyManager);
  }
}

async function callVolcVideoApi(
  apiKey: string,
  prompt: string,
  baseUrl: string,
  model: string,
  aspectRatio: string,
  imageWithRoles: Array<{ url: string; role: string }>,
  videoResolution?: string,
  duration?: number,
  cameraFixed?: boolean,
  onProgress?: (progress: number) => void,
  keyManager?: { handleError: (status: number) => boolean },
  /** Seedance 2.0: 闂傚倸鍊峰ù鍥х暦閻㈢绐楅柟鎵閸嬶繝鏌曟径鍫濆壔婵炴垶菤閺€浠嬫倵閿濆啫濡烽柛瀣崌瀹曟帒顭ㄩ崟顐わ紡濠电偞鎸婚崙褰掑垂閺夊簱鏋旈柕濞炬櫆閳锋垿鏌涘┑鍡楊仾鐎瑰憡绻傞埞鎴︻敊閻愵剚姣堥悗?URL 闂傚倸鍊搁崐椋庣矆娓氣偓楠炲鏁嶉崟顒佹濠德板€曢幊宀勫焵椤掆偓閸燁垰顕ラ崟顖氱疀妞?*/
  videoRefs?: string[],
  /** Seedance 2.0: 闂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸劍閺呮繈鏌曟径娑橆洭缂佺姵鍎抽埞鎴︽偐閸欏鍋嶉梺閫炲苯澧柛濠傤煼楠炴垿宕熼鍌滄嚌濡炪倖鐗楃喊宥夘敇閸ф鈷掑ù锝呮啞閹牊绻涚仦鍌氬闁逛究鍔戦幃鐣岀矙閹稿氦绶?URL 闂傚倸鍊搁崐椋庣矆娓氣偓楠炲鏁嶉崟顒佹濠德板€曢幊宀勫焵椤掆偓閸燁垰顕ラ崟顖氱疀妞?*/
  audioRefs?: string[],
): Promise<string> {
  const rootBase = getRootBaseUrl(baseUrl);
  // 闂傚倸鍊搁崐椋庣矆娓氣偓楠炴牠顢曢敂缁樻櫈闂佸憡渚楅崹顏堝磻閹炬剚娼╅柣鎾抽椤偆绱?content 闂傚倸鍊搁崐宄懊归崶褜娴栭柕濞炬櫆閸婂潡鏌ㄩ弮鍌涙珪闁绘繂鐖奸弻娑㈠焺閸愵亝鍣ч梺鎼炲妽缁诲嫰鍩€椤掆偓缁犲秹宕曢柆宓ュ洦瀵奸弶鎴犳煣濡炪倖甯掔€氼參鎮￠弴銏＄叆闁哄啫鍊藉鍛婁繆椤愶絾缍昪engine 闂傚倸鍊搁崐椋庣矆娓氣偓楠炴牠顢曢妶鍥╃厠闂佸壊鍋呭ú鏍磼閵娧勫枑闊洦鎷? text + image_url闂?
  const content: Array<Record<string, unknown>> = [];

  // 闂傚倸鍊搁崐椋庣矆娓氣偓楠炴牠顢曢敃鈧壕鍦磼鐎ｎ偓绱╂繛宸簼閺呮繈鏌嶈閸撶喖寮崘顔碱潊闁炽儲鍓氶崵銈夋⒑閸濆嫷妲归柛銊ョ秺钘濋柕濞炬櫆閳锋垿鏌涘☉姗堟缂佸爼浜堕弻娑樷枎韫囨稑寮伴悗瑙勬处閸ㄨ泛鐣烽崼鏇ㄦ晢濞达絽鎼铏節閻㈤潧浠﹂柛銊ョ埣閹兘顢涢悙鑼槷闂佺懓澧庨弲娓昿t + 闂傚倸鍊搁崐椋庣矆娓氣偓楠炲鏁撻悩鑼槷闂佸搫娲㈤崹鍦不閻樼粯鐓欓柟顖嗗苯娈跺銈傛櫇閸忔﹢寮诲☉銏╂晝闁绘ɑ褰冩慨搴ㄦ⒑濞茶骞楁い銊ワ躬瀵鈽夊顐ｅ媰闂佸憡鎸嗛埀顒佹叏閸パ€鏀介柣鎰皺婢ф洟鏌ｉ弽褋鍋㈢€?-rs, --rt, --dur, --cf闂?
  let textContent = prompt;
  const resolution = (videoResolution || '720p').toLowerCase();
  textContent += ` --rs ${resolution}`;
  textContent += ` --rt ${aspectRatio}`;
  if (duration) textContent += ` --dur ${duration}`;
  if (cameraFixed !== undefined) textContent += ` --cf ${cameraFixed}`;

  content.push({ type: 'text', text: textContent });

  // 闂傚倸鍊搁崐鐑芥倿閿曞倸绠栭柛顐ｆ礀绾惧潡寮堕崼娑樺婵炲懐濞€閺屻倝骞侀幒鎴濆濠电偛鎳愭繛鈧柡灞糕偓鎰佸悑閹肩补鈧磭顔愮紓鍌欒閸嬫捇鏌涢幇闈涙灍闁绘挻娲樼换娑㈠箣濠靛棜鍩為悗娈垮櫍缁犳牠寮诲☉銏″亜闂佸灝顑呴弸鐘绘⒑閸濆嫯顫﹂柛鏂跨焸閸┿儲寰勬繛銏㈠枛閹剝鎯斿Ο鍝勭阀婵犵绱曢崑鎴﹀磹閹版澘鐤鹃柣鎰皺閺嗭箓鏌ｉ姀銏╃劸闁?闂傚倸鍊峰ù鍥敋瑜忛幑銏ゅ箛椤旇棄搴婇梺纭呮彧缁犳垹澹曢崸妤佺厵闁诡垳澧楅ˉ澶岀磼閻欌偓閸犳骞堥妸銉庣喖宕归鎯у缚闂?
  for (const img of imageWithRoles) {
    if (img.url) {
      content.push({
        type: 'image_url',
        image_url: { url: img.url },
        role: img.role,
      });
    }
  }

  // Seedance 2.0 婵犵數濮烽弫鍛婃叏娴兼潙鍨傚┑鍌滎焾閺勩儵鏌″搴′簻闁哄鐗忛埀顒€绠嶉崕閬嶆偋閸℃稑姹查柣鎰劋閳锋帒霉閿濆洨鎽傞柛銈呭暣閺屾稖绠涢弮鍌樷偓鎺撶箾閸℃劕鐏插┑鈥崇埣瀹曞爼鈥﹂幋鐐电◥闂傚倷娴囬～澶愵敊閺嶎厼绐楁俊銈呮噹缁愭鏌涢埄鍐姇闁绘挻娲熼弻宥夊煛娴ｅ憡娈ㄧ紓浣哥埣娴滃爼寮婚敓鐘插耿闁归偊鍓欐慨銏ゆ⒑闁偛鑻晶顖涖亜閺冣偓閻楃姴鐣烽弶璇炬棃鍩€椤掑倸寮叉繝鐢靛Т閿曘倝鎮ч崱娑樺嚑濞撴埃鍋撻柡灞炬礋瀹曠厧鈹戦幇顓壯囨⒑閸濆嫭濯奸柛鎾跺枛瀵鈽夐姀鈺傛櫇闂佹寧绻傚ú銊╂偩閸濆嫷娓婚柕鍫濇婵啰绱掗鐣屾噧妞ゎ偄绻戠换婵嗩潩椤掑倸濮?缂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾惧湱鎲搁悧鍫濈瑲闁稿顑夐弻锝夊箛椤掑倷绮靛?闂傚倸鍊风粈渚€骞栭位鍥敃閿曗偓閻ょ偓绻濇繝鍌滃缂佲偓婢跺绠鹃柛鈩兩戠亸顓熸叏鐟欏嫮鍙€闁哄本绋戦埥澶愬础閻愬浜紓鍌欑婢у酣宕戦悢鐓庣劦妞ゆ巻鍋撶紒鐘茬Ч瀹曟洟鏌嗗鍛枃闁瑰吋鐣崝宥夊磻閸屾稓绡€闂傚牊绋撴晶銏㈢棯閹冩倯缂佺粯鐩獮瀣倻閸ワ妇杩旀繝纰夌磿鐎氬繘宕ㄩ婊愮床?
  if (videoRefs && videoRefs.length > 0) {
    for (const vUrl of videoRefs) {
      if (vUrl) {
        content.push({
          type: 'video_url',
          video_url: { url: vUrl },
        });
      }
    }
  }

  // Seedance 2.0 婵犵數濮烽弫鍛婃叏娴兼潙鍨傚┑鍌滎焾閺勩儵鏌″搴′簻闁哄鐗忛埀顒€绠嶉崕閬嶆偋閸℃稑姹查柣鎰劋閳锋帒霉閿濆洨鎽傞柛銈呭暣閺屾稖绠涢弮鍌樷偓鎺撶箾閸℃劕鐏插┑鈥崇埣瀹曞爼鈥﹂幋鐐电◥婵犵數鍋涢顓㈠储瑜旈幃娲Ω閳寡冾槹缁绘繈宕堕妸褍骞嶉梻浣告啞閹哥兘鎳楅崼鏇炵闁稿瞼鍋為悡娑㈡煕閳╁啫濮囬柛鏂诲€濋弻宥堫檨闁告挻宀搁、娆撳冀椤撶偟鐛ュ┑掳鍊愰崑鎾绘偂閵堝棛绡€濠电姴鍊绘晶鏇㈡煛鐎ｂ晝绐旈柡灞炬礋瀹曠厧鈹戦幇顓壯囨⒑閸濆嫭濯奸柛鎾跺枛瀵鈽夐姀鈩冩珕闂佸吋浜介崕鏌ュ窗閹?闂傚倸鍊搁崐椋庣矆娓氣偓楠炲鏁撻悩顔瑰亾閸愵喖绠涙い鏃傜摂濞肩喖姊洪崫鍕偍闁搞劌婀辨竟鏇熺節濮橆厾鍙嗗┑鐘绘涧濡瑥顔忓┑鍡╂富闁荤喐婢橀弳杈ㄣ亜椤撶偞鍋ラ柟铏矒閹粙鎮欓崗澶婁壕闁圭儤姊荤壕濂告煃?
  if (audioRefs && audioRefs.length > 0) {
    for (const aUrl of audioRefs) {
      if (aUrl) {
        content.push({
          type: 'audio_url',
          audio_url: { url: aUrl },
        });
      }
    }
  }

  const requestBody = { model, content };

  console.log('[VideoGen] Volc format 闂?POST /volc/v1/contents/generations/tasks', {
    model,
    resolution,
    aspectRatio,
    duration,
    imageCount: imageWithRoles.filter(i => i.url).length,
  });

  const submitResponse = await fetch(`${rootBase}/volc/v1/contents/generations/tasks`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(requestBody),
  });

  if (!submitResponse.ok) {
    const errorText = await submitResponse.text();
    console.error('[VideoGen] Volc video submit error:', submitResponse.status, errorText);
    handleVideoSubmitError(submitResponse.status, errorText, keyManager);
  }

  const submitData = await submitResponse.json();
  console.log('[VideoGen] Volc submit response:', submitData);

  // Volcengine 闂傚倸鍊搁崐椋庣矆娓氣偓楠炲鏁嶉崟顒€搴婇梺绋挎湰缁酣鎯岄幘缁樺€甸柛顭戝亞閹藉啫鈹? { id: "cgt-...", status: "submitted" }
  const taskId = submitData.id?.toString();
  if (!taskId) throw new Error('Video task id is missing from submit response.');

  // 闂傚倸鍊风粈渚€骞栭位鍥焼瀹ュ懐锛熼梺鍦濠㈡绮ｅΔ浣虹闁瑰瓨鐟ラ悞娲煛? GET /volc/v1/contents/generations/tasks/{taskId}
  const pollInterval = VIDEO_POLL_INTERVAL_MS;
  const maxAttempts = VIDEO_POLL_MAX_ATTEMPTS;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    onProgress?.(Math.min(20 + Math.floor((attempt / maxAttempts) * 80), 99));

    const statusResponse = await fetch(
      `${rootBase}/volc/v1/contents/generations/tasks/${taskId}`,
      {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
      },
    );

    if (!statusResponse.ok) {
      if (statusResponse.status === 404) throw new Error('Kling task not found.');
      console.warn('[VideoGen] Volc query failed:', statusResponse.status);
      await new Promise(r => setTimeout(r, pollInterval));
      continue;
    }

    const statusData = await statusResponse.json();
    console.log(`[VideoGen] Volc task ${taskId} status:`, statusData);

    // Volcengine 闂傚倸鍊搁崐鐑芥嚄閸撲礁鍨濇い鏍亹閳ь剨绠撳畷濂稿Ψ閵夛附袣闂備礁鎼粙渚€宕㈡總鍛婂€? queued | running | succeeded | failed | expired | cancelled
    const status = (statusData.status ?? 'unknown').toString().toLowerCase();

    if (status === 'succeeded') {
      // Volcengine 闂傚倸鍊搁崐椋庣矆娓氣偓楠炲鏁嶉崟顒€搴婇梺绋挎湰缁酣鎯岄幘缁樺€甸柛顭戝亞閹藉啫鈹? { content: { video_url: "..." } }
      const videoUrl = normalizeUrl(statusData.content?.video_url);
      if (!videoUrl) throw new Error('Video task completed but no video URL was returned.');
      return videoUrl;
    }

    if (status === 'failed' || status === 'expired' || status === 'cancelled') {
      const errorMsg = statusData.error?.message || statusData.error?.code || 'Volc video generation failed.';
      throw new Error(typeof errorMsg === 'string' ? errorMsg : JSON.stringify(errorMsg));
    }

    // queued / running 闂?缂傚倸鍊搁崐鎼佸磹閹间礁纾瑰瀣捣缁€濠囨煃瑜滈崜鐔煎蓟濞戞ǚ妲堥柛妤冨仧娴狀參姊洪崫鍕棛闁告濞婂濠氬焺閸愩劎绐為柣蹇曞仩濡嫭绔熸径鎰拺闁告縿鍎辨牎闂佺儵鏅╅崹鍫曞Υ?
    await new Promise(r => setTimeout(r, pollInterval));
  }
  throw new Error('Volc video generation timed out.');
}

// ==================== 闂傚倸鍊搁崐鎼佸磹妞嬪孩顐介柨鐔哄Т绾惧鏌涘☉妯兼憼闁稿孩顨嗛妵鍕棘閸喒鎸冩繛鎴炴尭缁夊綊寮婚敐澶婃闁圭瀛╅崰鎰版⒑瀹曞洨甯涙俊顐㈠暣瀵鈽夐姀鐘栥劍銇勯弮鍌滃笡闁圭櫢缍佸?wan 闂傚倸鍊搁崐椋庣矆娓氣偓楠炴牠顢曢妶鍥╃厠闂佸壊鍋呭ú鏍磼閵娧勫枑闊洦鎷?====================
// MemeFast 闂傚倸鍊搁崐椋庣矆娓氣偓楠炴牠顢曢敃鈧壕鍦磼鐎ｎ偓绱╂繛宸簼閺呮繈鏌涚仦缁㈠殼?
//   闂傚倸鍊搁崐椋庣矆娓氣偓楠炲鏁嶉崟顒佹濠德板€曢崯浼存儗濞嗘挻鐓欓悗鐢殿焾鍟哥紒? POST /ali/bailian/api/v1/services/aigc/video-generation/video-synthesis
//   闂傚倸鍊搁崐椋庣矆娓氣偓楠炴牠顢曢妶鍡椾粡濡炪倖鍔х粻鎴犲閸ф鐓欑紓浣靛灩濞呮﹢鏌? GET  /alibailian/api/v1/tasks/{task_id}

async function callWanVideoApi(
  apiKey: string,
  prompt: string,
  baseUrl: string,
  model: string,
  imageWithRoles: Array<{ url: string; role: string }>,
  resolution?: string,
  duration?: number,
  enableAudio?: boolean,
  onProgress?: (progress: number) => void,
  keyManager?: { handleError: (status: number) => boolean },
): Promise<string> {
  const rootBase = getRootBaseUrl(baseUrl);
  const firstFrame = imageWithRoles.find(img => img.role === 'first_frame');

  const requestBody: Record<string, unknown> = {
    model,
    input: {
      prompt,
      ...(firstFrame?.url ? { img_url: firstFrame.url } : {}),
    },
    parameters: {
      resolution: (resolution || '480P').toUpperCase(),
      prompt_extend: true,
      ...(duration ? { duration: Math.max(3, Math.min(10, duration)) } : {}),
      audio: enableAudio !== false,
    },
  };

  console.log('[VideoGen] Wan format 闂?POST /ali/bailian/api/v1/services/aigc/video-generation/video-synthesis', { model });

  const submitResponse = await fetch(
    `${rootBase}/ali/bailian/api/v1/services/aigc/video-generation/video-synthesis`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
    },
  );

  if (!submitResponse.ok) {
    const errorText = await submitResponse.text();
    console.error('[VideoGen] Wan video submit error:', submitResponse.status, errorText);
    handleVideoSubmitError(submitResponse.status, errorText, keyManager);
  }

  const submitData = await submitResponse.json();
  console.log('[VideoGen] Wan submit response:', submitData);

  // 闂傚倸鍊搁崐宄懊归崶顒佸剭妞ゆ劧绠戠粈鍐煏婵炲灝鐏悗鍨墵濮婄粯鎷呮笟顖滃姼闂佽崵鍣ユ禍顏勭暦閹偊妲虹紓浣稿船閻栧ジ骞冨Δ鍛祦闁割煈鍠栨慨搴ㄦ⒑绾懏鐝柛鏃€顨婇崺鈧? { request_id, output: { task_id, task_status: "PENDING" } }
  const taskId = submitData.output?.task_id;
  if (!taskId) throw new Error('Video task id is missing from submit response.');

  // 闂傚倸鍊风粈渚€骞栭位鍥焼瀹ュ懐锛熼梺鍦濠㈡绮ｅΔ浣虹闁瑰瓨鐟ラ悞娲煛? GET /alibailian/api/v1/tasks/{task_id}
  const pollInterval = VIDEO_POLL_INTERVAL_MS;
  const maxAttempts = VIDEO_POLL_MAX_ATTEMPTS;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    onProgress?.(Math.min(20 + Math.floor((attempt / maxAttempts) * 80), 99));

    const statusResponse = await fetch(
      `${rootBase}/alibailian/api/v1/tasks/${taskId}`,
      {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${apiKey}` },
      },
    );

    if (!statusResponse.ok) {
      if (statusResponse.status === 404) throw new Error('Kling task not found.');
      console.warn('[VideoGen] Wan query failed:', statusResponse.status);
      await new Promise(r => setTimeout(r, pollInterval));
      continue;
    }

    const statusData = await statusResponse.json();
    console.log(`[VideoGen] Wan task ${taskId} status:`, statusData);

    // 闂傚倸鍊搁崐宄懊归崶顒佸剭妞ゆ劧绠戠粈鍐煏婵炲灝鐏悗鍨墵濮婄粯鎷呮笟顖滃姼闂佽崵鍣ユ禍顏勭暦閹偊妲虹紓浣稿船閻栧ジ骞冨Δ鍛祦闁割煈鍠栨慨搴ㄦ⒑绾懏鐝柛鏃€顨婇崺鈧? { output: { task_status: "SUCCEEDED", video_url: "..." } }
    const taskStatus = (statusData.output?.task_status ?? '').toUpperCase();

    if (taskStatus === 'SUCCEEDED') {
      const videoUrl = normalizeUrl(statusData.output?.video_url);
      if (!videoUrl) throw new Error('Video task completed but no video URL was returned.');
      return videoUrl;
    }

    if (taskStatus === 'FAILED') {
      throw new Error(statusData.output?.message || statusData.output?.error || 'Wan video generation failed.');
    }

    await new Promise(r => setTimeout(r, pollInterval));
  }
  throw new Error('Wan video generation timed out.');
}

// ==================== Kling 闂傚倸鍊搁崐椋庣矆娓氣偓楠炲鏁撻悩鍐蹭画濡炪倖鐗滈崑娑㈠垂閸岀偞鐓ｉ煫鍥风到娴滄粍銇勯弴顫喚闁哄瞼鍠栭幃婊冾潨閸℃鏆ョ紓鍌欒閸嬫捇鏌涘畝鈧崑鐐烘偂韫囨挴鏀介柣鎰灥閸燁垶骞栭幇鐗堢厱婵☆垵宕甸幊鍥ㄦ叏婵犲啯銇濈€规洏鍔嶇换婵嬪磼濠婂懏鍤冨┑锛勫亼閸婃垿宕濈仦杞挎稑鈹戠€ｎ亞鐣洪悷婊冪箳閸掓帒鈻庤箛濠冪€婚梺璇″瀻閸曢潧鎮?====================
// MemeFast: POST /kling/v1/videos/{path} + GET /kling/v1/videos/{path}/{task_id}

// Native Kling endpoint paths (relative to /kling/v1/videos/)
// kling-video variants (kling-v2-1-master, kling-v3-0-pro, etc.) fall through to text2video / image2video
const KLING_VIDEO_PATH_MAP: Record<string, string> = {
  'kling-omni-video': 'omni-video',
  'kling-video-extend': 'video-extend',
  'kling-motion-control': 'motion-control',
  'kling-multi-elements': 'multi-elements',
  'kling-avatar-image2video': 'avatar/image2video',
  'kling-advanced-lip-sync': 'advanced-lip-sync',
  'kling-effects': 'effects',
};

async function callKlingVideoApi(
  apiKey: string,
  prompt: string,
  baseUrl: string,
  model: string,
  aspectRatio: string,
  imageWithRoles: Array<{ url: string; role: string }>,
  duration?: number,
  onProgress?: (progress: number) => void,
  keyManager?: { handleError: (status: number) => boolean },
): Promise<string> {
  const rootBase = getRootBaseUrl(baseUrl);
  const firstFrame = imageWithRoles.find(img => img.role === 'first_frame');
  const lastFrame = imageWithRoles.find(img => img.role === 'last_frame');

  // Determine the endpoint path: specialized models have a fixed path;
  // all kling-video variants fall through to text2video / image2video
  const specialPath = KLING_VIDEO_PATH_MAP[model];
  const endpointPath = specialPath || (firstFrame?.url ? 'image2video' : 'text2video');

  // Kling 闂?model_name 闂傚倸鍊搁崐椋庣矆娓氣偓瀹曘儳鈧綆浜堕悢鍡樹繆椤栨繂鍚归梻鍕閺岋繝宕橀妸銉㈠亾閼姐倗涓嶉柡鍌涱儥閻斿棝鏌ら幖浣规锭濠殿喖娲弻?model
  const requestBody: Record<string, unknown> = {
    model_name: model,
    prompt,
    aspect_ratio: aspectRatio,
    duration: duration ? String(Math.min(10, Math.max(5, duration))) : '5',
    mode: 'std',
  };

  // Attach image URLs for image-based endpoints
  if (endpointPath === 'image2video' && firstFrame?.url) {
    requestBody.image_url = firstFrame.url;
    if (lastFrame?.url) requestBody.tail_image_url = lastFrame.url;
  } else if (endpointPath === 'avatar/image2video' && firstFrame?.url) {
    requestBody.image_url = firstFrame.url;
  }

  const submitUrl = `${rootBase}/kling/v1/videos/${endpointPath}`;
  console.log('[VideoGen] Kling format', { endpointPath, model, submitUrl });

  const submitResponse = await fetch(submitUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(requestBody),
  });

  if (!submitResponse.ok) {
    const errorText = await submitResponse.text();
    console.error('[VideoGen] Kling video submit error:', submitResponse.status, errorText);
    handleVideoSubmitError(submitResponse.status, errorText, keyManager);
  }

  const submitData = await submitResponse.json();
  console.log('[VideoGen] Kling submit response:', submitData);

  // Kling 闂傚倸鍊搁崐椋庣矆娓氣偓楠炲鏁嶉崟顒€搴婇梺绋挎湰缁酣鎯岄幘缁樺€甸柛顭戝亞閹藉啫鈹? { code, message, data: { task_id, task_status } }
  const taskId = submitData.data?.task_id;
  if (!taskId) throw new Error('Video task id is missing from submit response.');

  // 闂傚倸鍊风粈渚€骞栭位鍥焼瀹ュ懐锛熼梺鍦濠㈡绮ｅΔ浣虹闁瑰瓨鐟ラ悞娲煛?URL 闂傚倸鍊搁崐鎼佸磹閹间礁纾归柣銏㈩焾绾惧鏌熼幆褜鍤熺紒鈾€鍋撳┑鐘垫暩婵挳宕愰幖浣告辈婵炲棙鎸婚悡鏇㈡煙閸撗冧缓闁稿鍨介弻鈥崇暆閳ь剟宕伴幘鑸殿潟闁圭儤鍤﹂悢鐓庝紶闁告洖鐏氱紞鍥р攽閻樻剚鍟忛柛鐘愁殜閺佸啴顢曢敐鍕畾闂佹悶鍎洪崜娆戠不閺屻儲鐓曢柡鍥ュ妼閻忛亶鏌℃担鍝バｉ柟渚垮妼铻ｅ鍓侇焾閹牓姊? GET /kling/v1/videos/{path}/{task_id}
  const pollUrl = `${rootBase}/kling/v1/videos/${endpointPath}/${taskId}`;
  const pollInterval = VIDEO_POLL_INTERVAL_MS;
  const maxAttempts = VIDEO_POLL_MAX_ATTEMPTS;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    onProgress?.(Math.min(20 + Math.floor((attempt / maxAttempts) * 80), 99));
    await new Promise(r => setTimeout(r, pollInterval));

    const statusResponse = await fetch(pollUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
    });

    if (!statusResponse.ok) {
      if (statusResponse.status === 404) throw new Error('Kling task not found.');
      console.warn('[VideoGen] Kling query failed:', statusResponse.status);
      continue;
    }

    const statusData = await statusResponse.json();
    console.log(`[VideoGen] Kling task ${taskId} status:`, statusData);

    // Kling 闂傚倸鍊搁崐椋庣矆娓氣偓楠炲鏁嶉崟顒€搴婇梺绋挎湰缁酣鎯岄幘缁樺€甸柛顭戝亞閹藉啫鈹? { data: { task_status: "succeed", task_result: { videos: [{ url }] } } }
    const taskStatus = (statusData.data?.task_status ?? '').toLowerCase();

    if (taskStatus === 'succeed' || taskStatus === 'success' || taskStatus === 'completed') {
      const videoUrl =
        normalizeUrl(statusData.data?.task_result?.videos?.[0]?.url) ||
        normalizeUrl(statusData.data?.task_result?.video_url) ||
        extractVideoUrl(statusData);
      if (!videoUrl) throw new Error('Video task completed but no video URL was returned.');
      return videoUrl;
    }

    if (taskStatus === 'failed' || taskStatus === 'error') {
      throw new Error(statusData.data?.task_status_msg || statusData.message || 'Kling video generation failed.');
    }
  }
  throw new Error('Kling video generation timed out.');
}

// ==================== OpenAI 闂傚倸鍊峰ù鍥敋瑜嶉～婵嬫晝閸岋妇绋忔繝銏ｆ硾鐎涒晠骞婂畝鍕拻濞达絽鎲￠幆鍫ユ煟椤掆偓閵堢鐣锋导鏉戠閻犲洩灏欓悿鍛存⒑閸︻叀妾搁柛鐘崇墵閻涱噣濮€閿涘嫮顔曢梺纭呮彧缂嶄線宕悜妯肩闁割偅绮庨惌娆愭叏婵犲啯銇濈€规洦鍋婂畷鐔碱敇婢跺牆鈧繈寮诲☉妯滅喖鎮╅崣澶婃濡?(sora-2) ====================
// MemeFast: POST /v1/videos (FormData) + GET /v1/videos/{taskId}

/**
 * Convert aspect ratio + resolution to Sora pixel size (e.g. '1280x720')
 */
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

async function callOpenAIOfficialVideoApi(
  apiKey: string,
  prompt: string,
  baseUrl: string,
  model: string,
  aspectRatio: string,
  imageWithRoles: Array<{ url: string; role: 'first_frame' | 'last_frame' }>,
  duration?: number,
  videoResolution?: string,
  onProgress?: (progress: number) => void,
  keyManager?: { handleError: (status: number) => boolean },
): Promise<string> {
  const isVeo = isVeoModel(model);
  const form = new FormData();
  form.append('model', model);
  form.append('prompt', prompt);
  form.append('size', isVeo ? toVeoOpenAIVideoSize(aspectRatio) : toSoraSize(aspectRatio, videoResolution));
  form.append('seconds', String(duration || (isVeo ? 8 : 10)));

  // 361 OpenAI video format (veo) supports image reference via input_reference.
  if (isVeo) {
    const firstFrame = imageWithRoles.find((img) => img.role === 'first_frame') || imageWithRoles[0];
    if (firstFrame?.url) {
      const refResp = await fetch(firstFrame.url);
      if (!refResp.ok) {
        throw new Error(`Veo reference image download failed: ${refResp.status}`);
      }
      const refBlob = await refResp.blob();
      form.append('input_reference', refBlob, 'veo-reference-1.png');
    }
  }

  const submitUrl = buildEndpoint(baseUrl, 'videos');
  console.log('[VideoGen] OpenAI Official format -> POST /v1/videos', {
    model,
    isVeo,
    size: isVeo ? toVeoOpenAIVideoSize(aspectRatio) : toSoraSize(aspectRatio, videoResolution),
    hasReference: isVeo && imageWithRoles.length > 0,
  });

  const submitResponse = await fetch(submitUrl, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}` },
    body: form,
  });

  if (!submitResponse.ok) {
    const errorText = await submitResponse.text();
    console.error('[VideoGen] Sora video submit error:', submitResponse.status, errorText);
    handleVideoSubmitError(submitResponse.status, errorText, keyManager);
  }

  const submitData = await submitResponse.json();
  console.log('[VideoGen] Sora submit response:', submitData);

  const taskId = (submitData.id || submitData.video_id)?.toString();
  const directUrl = extractVideoUrl(submitData);
  if (directUrl) return directUrl;
  if (!taskId) throw new Error('Video task id is missing from submit response.');

  // Poll: GET /v1/videos/{taskId}
  const pollUrl = buildEndpoint(baseUrl, `videos/${taskId}`);
  const pollInterval = VIDEO_POLL_INTERVAL_MS;
  const maxAttempts = VIDEO_POLL_MAX_ATTEMPTS;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    onProgress?.(Math.min(20 + Math.floor((attempt / maxAttempts) * 80), 99));
    await new Promise(r => setTimeout(r, pollInterval));

    const statusResponse = await fetch(pollUrl, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });

    if (!statusResponse.ok) continue;

    const statusData = await statusResponse.json();
    console.log(`[VideoGen] Sora task ${taskId} status:`, statusData);

    const status = String(statusData.status || '').toLowerCase();

    if (status === 'completed' || status === 'succeeded' || status === 'success') {
      const videoUrl = extractVideoUrl(statusData) || normalizeUrl(buildEndpoint(baseUrl, `videos/${taskId}/content`));
      if (!videoUrl) throw new Error('Video task completed but no video URL was returned.');
      return videoUrl;
    }

    if (status === 'failed' || status === 'error') {
      throw new Error(statusData.error?.message || statusData.error || statusData.message || 'Sora video generation failed.');
    }
  }
  throw new Error('Sora video generation timed out.');
}
async function callReplicateVideoApi(
  apiKey: string,
  prompt: string,
  baseUrl: string,
  model: string,
  aspectRatio: string,
  imageWithRoles: Array<{ url: string; role: string }>,
  duration?: number,
  videoResolution?: string,
  onProgress?: (progress: number) => void,
  keyManager?: { handleError: (status: number) => boolean },
): Promise<string> {
  const rootBase = getRootBaseUrl(baseUrl);

  const input: Record<string, unknown> = {
    prompt,
    duration: duration || 5,
    aspect_ratio: aspectRatio,
  };

  if (videoResolution) input.resolution = videoResolution;

  const firstFrame = imageWithRoles.find(img => img.role === 'first_frame') || imageWithRoles[0];
  if (firstFrame?.url) input.image = firstFrame.url;

  const lastFrame = imageWithRoles.find(img => img.role === 'last_frame');
  if (lastFrame?.url) input.tail_image = lastFrame.url;

  const submitUrl = `${rootBase}/replicate/v1/predictions`;
  console.log('[VideoGen] Replicate format -> POST /replicate/v1/predictions', { model });

  const submitResponse = await fetch(submitUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, input }),
  });

  if (!submitResponse.ok) {
    const errorText = await submitResponse.text();
    console.error('[VideoGen] Replicate video submit error:', submitResponse.status, errorText);
    handleVideoSubmitError(submitResponse.status, errorText, keyManager);
  }

  const submitData = await submitResponse.json();
  console.log('[VideoGen] Replicate submit response:', submitData);

  const directUrl = extractVideoUrl(submitData);
  if (directUrl) return directUrl;

  const predictionId = submitData.id?.toString();
  if (!predictionId) throw new Error('Replicate prediction id is missing from submit response.');

  const pollUrl = `${rootBase}/replicate/v1/predictions/${predictionId}`;
  const pollInterval = VIDEO_POLL_INTERVAL_MS;
  const maxAttempts = VIDEO_POLL_MAX_ATTEMPTS;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    onProgress?.(Math.min(20 + Math.floor((attempt / maxAttempts) * 80), 99));
    await sleep(pollInterval);

    const statusResponse = await fetch(pollUrl, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });

    if (!statusResponse.ok) continue;

    const statusData = await statusResponse.json();
    console.log(`[VideoGen] Replicate prediction ${predictionId} status:`, statusData);

    const status = String(statusData.status || '').toLowerCase();

    if (status === 'succeeded') {
      const videoUrl = extractVideoUrl(statusData);
      if (!videoUrl) throw new Error('Video task completed but no video URL was returned.');
      return videoUrl;
    }

    if (status === 'failed' || status === 'canceled') {
      throw new Error(statusData.error || 'Replicate video generation failed.');
    }
  }

  throw new Error('Replicate video generation timed out.');
}

// Save video to local and return the local URL
export async function saveVideoLocally(videoUrl: string, sceneId: number): Promise<string> {
  try {
    const filename = `scene_${sceneId + 1}_${Date.now()}.mp4`;
    const localUrl = await saveVideoToLocal(videoUrl, filename);
    console.log('[VideoGen] Video saved locally:', localUrl);
    return localUrl;
  } catch (e) {
    console.warn('[VideoGen] Failed to save video locally, using URL:', e);
    return videoUrl;
  }
}

/**
 * Extract the last frame from a video URL as base64 image
 * Uses video element + canvas for frame extraction
 * @param videoUrl - Video URL (HTTP or local)
 * @param seekOffset - Seconds before end to extract (default 0.1s from end)
 * @returns Base64 data URL of the frame, or null on failure
 */
export async function extractLastFrameFromVideo(
  videoUrl: string,
  seekOffset: number = 0.1
): Promise<string | null> {
  // local-image:// 闂?Electron 濠电姷鏁告慨鐑藉极閹间礁纾绘繛鎴旀嚍閸ヮ剦鏁囬柕蹇曞Х椤︻噣鎮楅崗澶婁壕闂佸憡娲﹂崑澶愬春閻愬绠鹃悗鐢殿焾瀛濆銈嗗灥濡繂鐣烽弴鐑嗗悑濠㈣泛顑囬崢閬嶆⒑閸濆嫭鍌ㄩ柛鏂跨焸瀵鈽夊▎鎴狀啎闂佸壊鍋呯划灞界暤閸℃稒鐓欐い鏃傜摂濞堟﹢鏌熼崣澶嬪唉鐎规洜鍠栭、姗€鎮╅幓鎺旂У缂傚倸鍊搁崐鐑芥嚄閼稿灚鍙忛柣鎴ｆ缁愭鏌″畵顔兼噺濞堥箖姊婚崟顐ｅ窛缂侇喛顕ч埥澶婎潨閸℃ê鍏婇梻浣虹帛閹稿摜鈧稈鏅犲鎶藉Ψ閳哄倵鎷绘繛杈剧悼閹虫捇顢氬鍛＜閻庯綆鍋勯悘鎾煙瀹曞洤鏋涙い銏＄☉閳规垿宕熼鍛綎闂傚倷绀侀幉锟犳偡閵夆敡鍥焼瀹ュ啠鍋撻崨瀛樺€婚柤鎭掑劤閸橆亝绻濋姀锝庡殐闁搞劍澹嗛埀顒佸嚬閸ｏ絽鐣峰▎鎰浄閻庯綆鍋€閹锋椽鏌ｉ悢鍝ユ噧閻庢凹浜幊婊堫敂閸喓鍘遍柟鑹版彧缁蹭粙銆傞懖鈺冪＜缂備焦顭囧ú瀵糕偓瑙勬礀閻栧ジ銆佸Δ浣瑰闂傗偓閹邦喚澶?
  // 婵犵數濮烽弫鎼佸磻閻愬搫鍨傞柛顐ｆ礀缁犱即鏌涘┑鍕姢闁活厽鎹囬弻锝夋偄鐠囪尙鍔烽梺閫炲苯澧悽顖椻偓宕囨殾婵犲﹤瀚刊鎾煟閻斿搫顣兼慨锝呮搐閳规垿鎮欓懜闈涙锭缂傚倸绉崑鎾寸節濞堝灝鏋旈柛濠冾殘閸掓帗绻濋崶鑸垫櫔闂侀€炲苯澧寸€殿喖顭烽幃銏ゆ倻濡櫣褰撮梻浣规灱閺呮盯宕幍顔剧幓闁哄啫鐗婇悡?file://
  const resolvedUrl = videoUrl;
  console.log('[VideoGen] Loading video for frame extraction:', resolvedUrl);
  
  return new Promise((resolve) => {
    const video = document.createElement('video');
    // local-image:// 闂傚倸鍊搁崐椋庣矆娓氣偓楠炴牠顢曢妶鍌氫壕婵ê宕崢瀵糕偓瑙勬礀缂嶅﹪鐛箛鏇氭勃閻犱浇娅曢惈蹇涙⒒娴ｇ顥忛柛瀣瀹曚即骞樼拠鑼幋閻庡箍鍎遍ˇ浼存偂閸愵喗鐓忓璺虹墕閸旀氨绱掗悪娆忔噳閸嬫挾鎲撮崟顒傤槰闂佺粯鎼换婵嗩嚕婵犳碍鏅插璺好￠埡鍛厪濠㈣泛鐗嗛崝鏉懨归悩灞傚仮闁诡喗顨堥幉鎾礋椤掑偆妲版俊鐐€戦崝宀勬偋閹捐崵宓侀煫鍥ㄦ磵閸嬫捇鏁愭惔鈩冪彯闂佽桨绀侀澶愬蓟濞戙垹鐒洪柛鎰典簼閸ｎ喖顪冮妶蹇撶槣闁哥姵顨堥幑銏犫槈閵忕姷顓洪梺缁樺姈濞兼瑧鍠婂鍥╃＝濞达絽澹婂Σ娲煙閾忣偅宕屽┑鈩冩尦楠炴帒螖閳ь剛绮堥崼婢濆綊鏁愰崶銊ユ畬闂?crossOrigin
    if (!resolvedUrl.startsWith('local-image://') && !resolvedUrl.startsWith('file://')) {
      video.crossOrigin = 'anonymous';
    }
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;
    
    let hasResolved = false;
    let targetTime = -1; // -1 闂傚倸鍊峰ù鍥х暦閻㈢纾婚柣鎰暩閻瑩鐓崶銊р槈缂佲偓婢舵劕绠规繛锝庡墮婵＄厧顩奸崨顓涙斀妞ゆ梹鏋绘笟娑㈡煕濡灝袚缂佸倸绉规俊鍫曞幢閺囩姷鐣炬俊鐐€栭悧妤冨垝鎼达絾鏆滄繛鎴炲焹閸嬫挸鈻撻崹顔界亶闂佸湱鎳撳ú顓㈢嵁閸愵亝鍠嗛柛鏇ㄥ墮椤庢挾绱撴担鍓插剰缂併劑浜堕獮鎰板礃椤旇В鎷?
    let isSeekStarted = false;
    
    const cleanup = () => {
      video.onloadedmetadata = null;
      video.onloadeddata = null;
      video.oncanplaythrough = null;
      video.onseeked = null;
      video.onerror = null;
      video.ontimeupdate = null;
      video.pause();
      video.src = '';
      video.load();
    };
    
    const timeoutId = setTimeout(() => {
      if (!hasResolved) {
        hasResolved = true;
        console.warn('[VideoGen] extractLastFrameFromVideo timeout');
        cleanup();
        resolve(null);
      }
    }, 30000); // 30s timeout
    
    const captureFrame = () => {
      if (hasResolved) return;
      
      // 缂傚倸鍊搁崐鐑芥嚄閸洘鎯為幖娣妼閻骞栧ǎ顒€濡肩紒鎰殜閺岋繝宕堕埡浣囷絿鈧娲栧鍫曞箞閵娿儙鐔煎锤濡も偓閹界敻姊洪崫銉バ㈡俊顐ｇ箞瀵鈽夐姀鐘靛姶闂佸憡鍓崨顖滅暢闂傚倷绀侀幖顐⑽涙惔銊ョ？闁汇垻顭堢粻鏍ㄤ繆椤栨繃纭堕柣銈傚亾闂備浇顫夐崕鎶芥偤閵娾晛纾块柟鐐墯濞撳鏌曢崼婵囶棡濠㈣泛瀚伴弻娑樷枎韫囨挻娈銈嗘穿缂嶄礁鐣疯ぐ鎺濇晝闁靛繈鍨婚悰顕€姊虹拠鎻掑毐缂傚秴妫濆畷鎴﹀川鐎涙ê浠?
      if (video.videoWidth === 0 || video.videoHeight === 0) {
        console.warn('[VideoGen] Video dimensions not ready, waiting...');
        setTimeout(captureFrame, 100);
        return;
      }
      
      try {
        video.pause();
        
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        
        if (!ctx) {
          console.warn('[VideoGen] Cannot get canvas context');
          hasResolved = true;
          clearTimeout(timeoutId);
          cleanup();
          resolve(null);
          return;
        }
        
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
        
        console.log('[VideoGen] Extracted last frame:', {
          width: canvas.width,
          height: canvas.height,
          duration: video.duration,
          currentTime: video.currentTime,
          targetWas: targetTime,
        });
        
        hasResolved = true;
        clearTimeout(timeoutId);
        cleanup();
        resolve(dataUrl);
      } catch (e) {
        console.warn('[VideoGen] Failed to extract frame:', e);
        hasResolved = true;
        clearTimeout(timeoutId);
        cleanup();
        resolve(null);
      }
    };
    
    // 闂傚倷娴囬褏鈧稈鏅犻、娆撳冀椤撶偟鐛ラ梺鍦劋椤ㄥ懐澹曟繝姘厵闁绘劦鍓氶悘閬嶆煛閳?seek 闂傚倸鍊搁崐鐑芥倿閿曞倹鍎戠憸鐗堝笒缁€澶屸偓鍏夊亾闁逞屽墴閸┾偓妞ゆ帊绀侀崵顒勬煕閹捐泛鏋庨柣锝囧厴閹粙宕ㄦ繝鍕Ц闁诲骸绠嶉崕閬嶅箠韫囨稒鍊?
    const startSeek = () => {
      if (hasResolved || isSeekStarted) return;
      
      const duration = video.duration;
      if (!duration || duration <= 0 || !isFinite(duration)) {
        console.warn('[VideoGen] Invalid video duration:', duration);
        return;
      }
      
      isSeekStarted = true;
      targetTime = Math.max(0.1, duration - seekOffset);
      console.log('[VideoGen] Starting seek, duration:', duration, 'target:', targetTime);
      
      video.currentTime = targetTime;
    };
    
    // 闂傚倸鍊搁崐椋庣矆娓氣偓楠炴牠顢曢敃鈧壕鐟懊归悩宸劀缂傚秵鐗曢…璺ㄦ崉閻戞ɑ鎷遍梺绋跨箲缁捇寮诲☉銏╂晝闁挎繂妫涢ˇ銊╂⒑閸濆嫭濯奸柛鎾村哺楠炲牓濡搁妷顔藉缓闂佺硶鍓濋妵鐐佃姳婵犳碍鈷戦悗鍦閸ゆ瑧绱掔紒姗堣€跨€?timeupdate 闂傚倸鍊搁崐鐑芥嚄閸洖纾块柣銏㈩焾閻ょ偓绻濇繝鍌滃闁搞劌鍊块弻锝夊閵忊晝鍔哥紓浣哄У閼归箖鈥﹂崸妤佸殝闂傚牊绋戦～宀€绱撴担鍝勑ョ紒顕呭灦婵＄敻宕熼姘鳖啋闁荤姾娅ｉ崕銈夋倵妤ｅ啯鈷戦柛婵嗗濡插摜绱撳鍜冨伐妞ゆ洩缍佸畷濂稿即閻愰潧骞愰梻浣侯焾閺堫剚绔熼弴鐐嶏綁宕奸妷锔惧幗闁瑰吋鐣崐銈咁焽閹邦兘鏀介柣鎰嚋闊剛鈧鍣崑鍕敇婵傜鐐婇柨鏃囨婵即姊绘担椋庝覆缂佽弓绮欓幆澶愬礂閼测晜鎯為梻鍌氬€搁崐宄懊归崶顒婄稏濠㈣泛顑囬々鎻捗归悩宸剰缁炬儳娼￠幃妤呮濞戞瑥鏆堥悗瑙勬礃閻擄繝鐛弽顬ュ酣顢楅埀顒佷繆娴犲鐓曢幖绮光偓鎰佸妷闂侀潧娲ょ€氭澘顕ｉ鈧畷鎺戔槈濞嗘垵娑ч梻鍌欑劍閹爼宕濆畝鍕ч柟闂寸閽冪喖鏌ㄩ悢鍝勑㈢紒鈧崘顔界厪濠电倯鍐ㄦ殶闁告濮ょ换婵堝枈濡椿娼戦梺绋款儏鐎氼剟鈥﹂崶顒€鐏抽柟棰佺濞堛劌顪冮妶鍡樼５闁稿鎹囬弻鐔兼惞椤愩倗鐓夊┑鈽嗗亜閸燁偊鍩ユ径濠庢僵闁稿繐銇欒濮?
    video.ontimeupdate = () => {
      if (hasResolved || targetTime < 0) return; // 闂傚倸鍊搁崐椋庣矆娓氣偓楠炴牠顢曢敂钘変罕濠电姴锕ょ€氼噣銆呴崣澶岀瘈濠电姴鍊归崳鐑樸亜椤愶絾绀嬮柡宀€鍠撻埀顒傛暩椤牊绂掗敃鍌涚厱?seek 闂傚倸鍊搁崐椋庣矆娓氣偓楠炴牠顢曢敃鈧悿顕€鏌涢幇顓犮偞闁哄鐗楃换娑㈠箣濞嗗繒浠肩紓浣哄閸ㄥ爼寮婚敐澶婄闁挎繂鎲涢幘缁樼厱?
      
      // 闂傚倷娴囧畷鐢稿窗閹邦喖鍨濋幖娣灪濞呯姵淇婇妶鍛櫣缂佺姵婢橀埞鎴︽偐鐎圭姴顥濈紓浣哄С閸楀啿顫忓ú顏嶆晢闁逞屽墰缁梻鈧潧鎽滅壕濂告煃閸濆嫭鍣洪柣鎾寸懄閵囧嫰寮借椤ユ粓鏌涢悢璺哄祮鐎规洏鍨介獮鎺懳旀担鍙夊闂備胶绮崹鐔煎疾濠婂啠鏋嶉柟鍓х帛閻撴洟鏌ｅΟ璇插婵炲牊绮撻弻鐔碱敊閸濆嫬濮﹂梺杞扮劍閸旀牕顕ラ崟顒傜瘈闁告洦鍘界紞渚€姊婚崒娆戭槮濠㈢懓锕畷鎴﹀川椤掔厧鎼～婊堝焵椤掑嫬鏋佺€广儱顦伴崑鍕煕韫囨挾姣為柟宄邦煼濮婃椽宕ㄦ繝鍐槱闂佺顑呯€氫即銆侀弮鍫晢闁稿本绮庨敍婊堟煟閻樺弶澶勯柣鎿勭節瀹曪綁宕熼娑樹壕婵炲牆鐏濆▍姗€鏌涢敐蹇曠М妤犵偛锕ら…銊╁醇閻曚焦顥堟繝鐢靛仦閸ㄥ爼宕欓悷鎷旓綀銇愰幒鎾嫽婵炶揪绲块…鍫ュ箖閹达附鐓曢幖娣灩閳绘洜鈧娲橀悡鈥愁嚕婵犳艾唯闁靛／灞芥暥?
      if (video.currentTime >= targetTime - 0.05) {
        console.log('[VideoGen] timeupdate reached target, currentTime:', video.currentTime, 'target:', targetTime);
        captureFrame();
      }
    };
    
    // 闂?seek 闂傚倸鍊峰ù鍥敋瑜嶉湁闁绘垼妫勭粻鐘绘煙閹规劦鍤欓悗姘槹閵囧嫰骞掗幋婵愪患闂佹悶鍔岄崐褰掑箞閵娿儙鐔煎箰鎼达絻鈧劗绱撴笟鍥т簻缂佸缍婂濠氬Χ婢跺﹦顔愭繛杈剧秬椤鏌ㄩ鐘电＝濞达絾褰冩禍楣冩煟鎼搭垳绉甸柛鐘愁殜閹?
    video.onseeked = () => {
      if (hasResolved || targetTime < 0) return;
      console.log('[VideoGen] onseeked fired, currentTime:', video.currentTime, 'target:', targetTime);
      
      // 濠电姷鏁告慨鐑姐€傞挊澹╋綁宕ㄩ弶鎴狅紱闂侀€炲苯澧撮柡灞剧〒閳ь剨缍嗛崑鍛暦瀹€鍕厸鐎光偓鐎ｎ剛锛熸繛瀵稿婵″洭骞忛悩璇茬闁圭儤鍩堝銉モ攽閻樻鏆柍褜鍓欓崯璺ㄧ棯瑜旈弻鐔碱敊閻撳簶鍋撻幖浣瑰仼闁绘垼妫勫敮闂佸啿鎼崐鐟扳枍閸℃稒鈷戠紓浣姑慨锕傛煕閹惧鎳囬柟顔惧仱楠炴牗鎷呴崗澶嬪?seek 闂傚倸鍊搁崐椋庣矆娓氣偓楠炲鏁嶉崟顒佹闂佽法鍠撴慨浼村焵椤掆偓閸婂潡寮崒鐐茬闁归偊鍎烽敓鐘斥拺閻犳亽鍔岄弸鏂库攽椤旂偓鏆€规洘娲橀幆鏃堬綖椤戣法鐩庨梻浣告惈閸燁偊宕愰悷鎵虫瀺闁哄洢鍨洪悡鏇㈡煏婵炑冨暙娴犳﹢姊婚崶褜妯€闁哄被鍔岄埞鎴﹀幢濡儤顏ら梺鐓庡级閻楃姴顫?
      if (Math.abs(video.currentTime - targetTime) < 0.5) {
        // seek 闂傚倸鍊搁崐鐑芥嚄閸洖绠犻柟鍓х帛閸嬨倝鏌曟繛鐐珔缂佲偓婢舵劖鐓涢柛銉㈡櫅閺嬫垿鏌涘▎蹇曠缂佺粯鐩獮瀣枎韫囨洑鐥梻浣告惈閹峰宕滃☉銏犵劦妞ゆ巻鍋撻柛妯荤矒瀹曟垿骞樼紒妯煎帗閻熸粍绮撳畷婊堟偄閻撳海鐣哄┑鐐叉▕娴滄粎绮婚敐鍡欑瘈闁割煈鍋勬慨鍥ㄧ箾閸偄浜版慨濠冩そ瀹曘劍绻濇担铏圭畳闂備礁鎲￠幐濠氭儎椤栫偑鈧線寮崼婵堫攨闂佺粯鍔忛弲婊堬綖瀹ュ鈷戦柛锔诲幖娴滈箖鏌涢幘鏉戝摵鐎规洘娲濈粻娑樷槈濞嗘垵骞堥梻浣虹帛濮婄銇愰崘鈺冾洸濡わ絽鍟埛鎺懨归敐鍕劅闁衡偓閻楀牄浜滄い鎰╁焺濡叉悂鎮￠妶鍡欑瘈闂傚牊渚楅崕鎴犫偓?
        setTimeout(captureFrame, 200);
      } else {
        // seek 闂傚倸鍊搁崐椋庣矆娓氣偓楠炲鏁撻悩鍐蹭画濡炪倖鐗滈崑娑㈠垂閸岀偞鐓熼柕蹇嬪焺閻掑墽绱掗埀顒勫磼濞戞绠氬銈嗙墬缁诲秹宕靛▎鎴犵＜闁告挷绀佹禒杈┾偓娈垮枛閻栫厧鐣锋總鍓叉晝妞ゎ偒鍘奸崵閬嶆煟閻愬顣茬紒璇茬墕椤繐煤椤忓嫮顔囬柟鑹版彧缁插搫危閸儲鈷戦柛蹇撳悑閵囩喖鏌涢妸銉у煟妤犵偛妫濆畷姗€顢欓懖鈺婃Ф闁荤喐绮屽ù鐑藉焵椤掍胶顣茬€光偓閹间礁钃熼柨鐔哄Т閻愬﹪鏌嶆潪鎵妽闁诲酣绠栭弻锝堢疀閹捐崵宕紓浣虹帛缁诲牆顕ｆ繝姘櫢闁绘灏欓崝锕€顪冮妶鍡楃瑨閻庢凹鍓涚划璇差潩鏉堛劌鏋戦悗骞垮劚椤︿即宕戦崒鐐寸厱鐎光偓閳ь剟宕戦悙鐑樺亗闁绘柨鍚嬮悡鍐煕濠靛棗顏电€规悶鍎甸弻锛勨偓锝庡墮閺嬫盯鏌″畝瀣М鐎殿喕绮欓幃浠嬫偨閻亝鍨垮娲偡閺夋寧些闂佺懓鍟块柊锝夈€佸Ο鑽ら檮缂佸娉曢崐鐐烘⒑閸愬弶鎯堥柛濠傤煼閸┾偓?
        console.log('[VideoGen] Seek may have failed, trying play approach...');
        video.playbackRate = 16; // 闂傚倸鍊搁崐鎼佲€﹂鍕；闁告洦鍊嬭ぐ鎺戠＜闁绘劘灏欓敍娑欑節閻㈤潧孝婵炲眰鍊濋幃鐐哄垂椤愮姳绨婚梺鍦劋閸ㄧ敻鍩€椤掍焦鍊愮€殿喗鎮傞獮瀣晜閻ｅ苯骞嶉梻浣哥秺濡灝顪冮幒妤€绠熼柛鎾椻偓閸?
        video.play().catch(() => {
          // 婵犵數濮烽弫鍛婃叏閻戝鈧倹绂掔€ｎ亞鍔﹀銈嗗坊閸嬫捇鏌涢悢閿嬪仴闁糕斁鍋撳銈嗗坊閸嬫挾绱撳鍜冭含妤犵偛鍟灒閻犲洩灏欑粣鐐烘⒑瑜版帒浜伴柛鎾寸洴椤㈡瑩骞掗幋顓熷瘜闂侀潧鐗嗗Λ娆戜焊閻㈠憡鐓曢柣妯哄暱婵秶鈧鍠栭悥濂稿箖閻戣姤鐒介柨鏃€鍎抽弫鎼佹⒒娴ｇ瓔鍤冮柛銊ㄩ哺缁旂喖宕卞▎鎺懶￠梺绉嗗嫷娈曢柛瀣у墲缁绘盯宕卞Ο鍏煎櫘闂佷紮绲块弫濠氬蓟閳╁啯濯撮柛婵勫剾閵忋倖鐓熼柨婵嗘缁犵偤鏌涢埞鎯т壕婵＄偑鍊栧濠氬磻閹剧粯鍋傞柕鍫濐槹閻撴洜鎲告惔銊ｂ偓鍐川椤栨粈绗夐梺瑙勫劶婵倝鎮¤箛鎿冪唵闁煎摜鏁搁妴鎺楁煟閿濆牅鍚紒杈ㄥ浮閸┾偓妞ゆ帒鍊甸崑鎾绘晲鎼粹剝鐏嶉梺缁樻尵婵炩偓闁哄瞼鍠栭、娑㈠幢濡も偓閺嗙偞绂嶅☉姘辩＝闁稿本鑹鹃埀顒€鎽滅划鏃堝箻椤曞懏鏅炴繝銏ｆ硾閿曪箓寮抽敂鐣岀瘈濠电姴鍊搁弸銈夋煕濮橆剦鍎旈柡灞剧☉閳藉宕￠悙瀵镐邯婵?
          console.warn('[VideoGen] Play failed, capturing current frame');
          captureFrame();
        });
      }
    };
    
    // 闂傚倷娴囧畷鐢稿窗閹邦喖鍨濋幖娣灪濞呯姵淇婇妶鍛櫣缂佺姵褰冮妴鎺戭潩閿濆懍澹曢梻浣瑰缁诲嫰宕戦悢鐓庣劦妞ゆ帒锕︾粔鐢告煕鐎ｎ偅灏垫俊鍙夊姍閺佹劖寰勭€ｎ剙骞嶉梺璇叉捣閺佹悂鈥﹂崼鐔侯浄闁挎梻鏅粻楣冩煕椤愶絿绠橀柛鈺嬬秮閺屸€崇暆閳ь剟宕伴幘璇茬闁绘顕ч悘鎶芥煣韫囷絽浜炲ù婊庝簻閳规垿鎮╅幇浣告櫛闂佸摜濮靛畝绋跨暦閹达附鍊风€瑰壊鍠氶崝宄邦渻閵堝懐绠伴柣妤€锕﹂埀顒傛暩婵挳鈥︾捄銊﹀磯闁绘垶蓱閹峰崬鈹戦悙鑼⒈闁革綇绲介～蹇撁洪鍛画闂佽顔栭崰妤呭箟婵傚憡鈷戦柛娑橈攻閳锋劙鏌ｅΔ浣圭闁炽儲妫冨畷姗€顢欓懖鈺嬬床婵犵數濮磋墝闁稿鎹囬弻锝夊箳閹搭垱鏁剧紓浣虹帛缁诲牆螞閸愩劉妲堥柛鎰絻椤姵绻?seek
    video.onloadeddata = () => {
      if (hasResolved) return;
      console.log('[VideoGen] onloadeddata, readyState:', video.readyState, 'duration:', video.duration);
      startSeek();
    };
    
    // 闂傚倷娴囧畷鐢稿窗閹邦喖鍨濋幖娣灪濞呯姵淇婇妶鍛櫣缂佺姷澧楅幈銊モ攽閸℃凹娼舵繛瀛樼矊缂嶅﹪寮诲☉妯锋瀻闊浄绲炬婵＄偑鍊愰弲婵嬪礂濮椻偓瀵寮撮悢椋庣獮濠电偞鍨崹娲敁瀹ュ鐓熼煫鍥ㄦ崌閻涙粎绱掔紒妯肩疄鐎殿喖顭烽弫鎾绘偐閼碱剙濮︽俊鐐€栫敮鎺斺偓姘煎弮瀹曟劙鏌ㄧ€ｃ劋绨婚梺鐟版惈缁夊墎鎷归悧鍫滅箚鐎瑰壊鍠栭悘锛勭磼缂佹娲存鐐差儔閹瑧鍒掔憴鍕伜闂傚倷绀侀幗婊勬叏閹绢喗鐓€闁挎繂顦粻姘舵煕閹伴潧鏋涚紒鈧崼銏″枑閹艰揪绲洪崑?seek闂傚倸鍊搁崐鐑芥倿閿旈敮鍋撶粭娑樻噽閻瑩鏌熸潏楣冩闁稿顑夐弻娑㈠焺閸愵厽宸㈤梺鎼炲労閸擄箓寮崱娑欑厱闁哄洢鍔屾晶浼存煕閺傝法浠涚紒缁樼箞婵偓闁挎繂鎳愰崢顐ょ磽娴ｅ壊鍎愰柟绋垮⒔閸?
    video.oncanplaythrough = () => {
      if (hasResolved) return;
      console.log('[VideoGen] oncanplaythrough, readyState:', video.readyState, 'duration:', video.duration);
      startSeek();
    };
    
    video.onerror = (e) => {
      if (!hasResolved) {
        hasResolved = true;
        console.warn('[VideoGen] Video load error:', e);
        clearTimeout(timeoutId);
        cleanup();
        resolve(null);
      }
    };
    
    video.src = resolvedUrl;
    video.load();
  });
}

// ==================== 闂傚倸鍊搁崐宄懊归崶銊х彾闁割偆鍠嗘禒鍫㈢磼鐎ｎ厽纭堕柡鍡楁閺岀喖姊荤€靛壊妲紓浣哄Х婵炩偓闁诡喗顨呴埥澶婎潨閸℃ɑ娅孖 Grok Video Generation ====================

/**
 * Convert aspect ratio to Grok format
 */
function toGrokAspectRatio(aspectRatio: string): string {
  // Grok supports: 2:3, 3:2, 1:1
  if (aspectRatio === '9:16' || aspectRatio === '3:4') return '2:3';
  if (aspectRatio === '1:1') return '1:1';
  // 16:9, 4:3, 21:9 闂?3:2 (closest landscape)
  return '3:2';
}

/**
 * Call JuxinAPI (Grok) video generation API
 * API Documentation: https://juxinapi.apifox.cn/doc-7302525
 * 
 * Create video: POST /v1/video/create
 * Query task: GET /v1/video/query?id={taskId}
 */
export async function callJuxinVideoGenerationApi(
  apiKey: string,
  prompt: string,
  aspectRatio: string,
  imageWithRoles: Array<{ url: string; role: 'first_frame' | 'last_frame' }>,
  onProgress?: (progress: number) => void,
  keyManager?: { handleError: (status: number) => boolean; getAvailableKeyCount: () => number; getTotalKeyCount: () => number },
  baseUrl?: string,
  model?: string,
): Promise<string> {
  const apiBaseUrl = baseUrl?.replace(/\/+$/, '');
  if (!apiBaseUrl) {
    throw new Error('Video API base URL is not configured.');
  }
  if (!model) {
    throw new Error('Video model is not configured.');
  }

  const images: string[] = [];
  const firstFrame = imageWithRoles.find(img => img.role === 'first_frame');
  if (firstFrame?.url) images.push(firstFrame.url);

  const requestBody = {
    model,
    prompt,
    aspect_ratio: toGrokAspectRatio(aspectRatio),
    size: '720P',
    images,
  };

  const submitResponse = await fetch(buildEndpoint(apiBaseUrl, 'video/create'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(requestBody),
  });

  if (!submitResponse.ok) {
    const errorText = await submitResponse.text();
    handleVideoSubmitError(submitResponse.status, errorText, keyManager);
  }

  const submitData = await submitResponse.json();
  const taskId = String(submitData.id || submitData.task_id || '');
  if (!taskId) {
    throw new Error('Video task id is missing from submit response.');
  }

  for (let attempt = 0; attempt < VIDEO_POLL_MAX_ATTEMPTS; attempt++) {
    onProgress?.(Math.min(20 + Math.floor((attempt / VIDEO_POLL_MAX_ATTEMPTS) * 80), 99));
    await sleep(VIDEO_POLL_INTERVAL_MS);

    const queryUrl = new URL(buildEndpoint(apiBaseUrl, 'video/query'));
    queryUrl.searchParams.set('id', taskId);

    const statusResponse = await fetch(queryUrl.toString(), {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
    });

    if (!statusResponse.ok) {
      if (statusResponse.status === 404) throw new Error('Video task not found.');
      continue;
    }

    const statusData = await statusResponse.json();
    const status = getVideoTaskStatus(statusData);

    if (status === 'completed' || status === 'succeeded' || status === 'success') {
      let videoUrl = extractVideoUrl(statusData);
      if (!videoUrl) {
        videoUrl = await refetchVideoUrlAfterCompletion(async () => {
          const followResponse = await fetch(queryUrl.toString(), {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json',
              'Authorization': `Bearer ${apiKey}`,
            },
          });
          if (!followResponse.ok) return null;
          return followResponse.json();
        });
      }
      if (videoUrl) return videoUrl;
      continue;
    }

    if (status === 'failed' || status === 'error') {
      throw new Error(getVideoTaskErrorMessage(statusData));
    }
  }

  throw new Error('Video generation timed out.');
}
