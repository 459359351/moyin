// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

export type VeoEndpointFamily = 'unified' | 'openai_videos' | 'unknown';
export type VeoUploadMode = 'none' | 'single' | 'first_last' | 'multi';

export type VeoUploadSlotKey = 'single' | 'first' | 'last' | 'reference';

export interface VeoUploadSlot {
  key: VeoUploadSlotKey;
  label: string;
  required: boolean;
}

export interface VeoUploadCapability {
  isVeo: boolean;
  endpointFamily: VeoEndpointFamily;
  mode: VeoUploadMode;
  minFiles: number;
  maxFiles: number;
  slots: VeoUploadSlot[];
}

const EMPTY_CAPABILITY: VeoUploadCapability = {
  isVeo: false,
  endpointFamily: 'unknown',
  mode: 'none',
  minFiles: 0,
  maxFiles: 0,
  slots: [],
};

export function isVeoModel(model: string): boolean {
  return /^veo(?:_|[0-9]|\.)/i.test(model);
}

function resolveVeoEndpointFamily(endpointTypes?: string[]): VeoEndpointFamily {
  if (!endpointTypes || endpointTypes.length === 0) return 'unknown';

  const normalized = endpointTypes.map(t => t.toLowerCase());

  if (
    normalized.some(t => t.includes('/v1/videos')) ||
    normalized.some(t => t.includes('sora')) ||
    normalized.some(t => t.includes('openai') && t.includes('video'))
  ) {
    return 'openai_videos';
  }

  if (
    normalized.some(t => t.includes('openai-response')) ||
    normalized.some(t => t.includes('/v1/video')) ||
    normalized.some(t => t.includes('video/generations'))
  ) {
    return 'unified';
  }

  return 'unknown';
}

export function resolveVeoUploadCapability(
  model: string,
  endpointTypes?: string[],
): VeoUploadCapability {
  if (!isVeoModel(model)) return EMPTY_CAPABILITY;

  const family = resolveVeoEndpointFamily(endpointTypes);
  const lower = model.toLowerCase();
  const isComponents = lower.includes('components');
  const isFrames = lower.includes('frames');
  const isVeo2Frames = lower.includes('veo2') && isFrames;
  const isOpenAIFast4K = /^veo_3_1-fast-4k$/i.test(model);
  // veo3.1 / veo_3_1 families support optional first/last frame inputs (adaptive i2v/t2v).
  const isVeo31Adaptive = /^(veo3\.1|veo_3_1)(?:-|$)/i.test(model);

  if (isComponents) {
    return {
      isVeo: true,
      endpointFamily: family,
      mode: 'multi',
      minFiles: 1,
      maxFiles: 3,
      slots: [
        { key: 'reference', label: 'Reference 1', required: true },
        { key: 'reference', label: 'Reference 2', required: false },
        { key: 'reference', label: 'Reference 3', required: false },
      ],
    };
  }

  if (isVeo2Frames || isOpenAIFast4K || isVeo31Adaptive) {
    return {
      isVeo: true,
      endpointFamily: family,
      mode: 'first_last',
      minFiles: isVeo2Frames ? 1 : 0,
      maxFiles: 2,
      slots: [
        { key: 'first', label: 'First frame', required: isVeo2Frames },
        { key: 'last', label: 'Last frame', required: false },
      ],
    };
  }

  if (isFrames) {
    return {
      isVeo: true,
      endpointFamily: family,
      mode: 'single',
      minFiles: 1,
      maxFiles: 1,
      slots: [{ key: 'single', label: 'First frame', required: true }],
    };
  }

  return {
    isVeo: true,
    endpointFamily: family,
    mode: 'none',
    minFiles: 0,
    maxFiles: 0,
    slots: [],
  };
}