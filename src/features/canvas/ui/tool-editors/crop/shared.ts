import { centerCrop, makeAspectCrop, type Crop, type PixelCrop } from 'react-image-crop';

export const VIEWPORT_PADDING_PX = 20;
export const VIEWPORT_MIN_WIDTH_PX = 220;
export const VIEWPORT_MIN_HEIGHT_PX = 180;

export interface RatioOption {
  label: string;
  value: string;
}

export interface Size2D {
  width: number;
  height: number;
}

export interface ImageSpaceCrop {
  cropX: number;
  cropY: number;
  cropWidth: number;
  cropHeight: number;
}

const DEFAULT_RATIO_OPTIONS: RatioOption[] = [
  { label: '自由', value: 'free' },
  { label: '1:1', value: '1:1' },
  { label: '16:9', value: '16:9' },
  { label: '9:16', value: '9:16' },
  { label: '4:3', value: '4:3' },
  { label: '3:4', value: '3:4' },
  { label: '3:2', value: '3:2' },
  { label: '2:3', value: '2:3' },
  { label: '4:5', value: '4:5' },
  { label: '5:4', value: '5:4' },
  { label: '2:1', value: '2:1' },
  { label: '21:9', value: '21:9' },
  { label: '原图', value: 'original' },
];

export function getDefaultRatioOptions(): RatioOption[] {
  return DEFAULT_RATIO_OPTIONS;
}

export function parsePresetRatio(value: string): number | null {
  if (!value.includes(':')) {
    return null;
  }

  const [rawW, rawH] = value.split(':').map((item) => Number(item));
  if (!Number.isFinite(rawW) || !Number.isFinite(rawH) || rawW <= 0 || rawH <= 0) {
    return null;
  }

  return rawW / rawH;
}

export function parseCustomRatio(value: string): number | null {
  const input = value.trim();
  if (!input) {
    return null;
  }

  if (input.includes(':')) {
    return parsePresetRatio(input);
  }

  const numeric = Number(input);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }

  return numeric;
}

export function toNumber(value: DynamicValue): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function toImageSpaceCrop(
  crop: PixelCrop,
  renderedWidth: number,
  renderedHeight: number,
  naturalWidth: number,
  naturalHeight: number
): ImageSpaceCrop {
  const scaleX = naturalWidth / renderedWidth;
  const scaleY = naturalHeight / renderedHeight;

  return {
    cropX: Math.round(crop.x * scaleX),
    cropY: Math.round(crop.y * scaleY),
    cropWidth: Math.round(crop.width * scaleX),
    cropHeight: Math.round(crop.height * scaleY),
  };
}

export function toRenderedCrop(
  cropX: number,
  cropY: number,
  cropWidth: number,
  cropHeight: number,
  renderedWidth: number,
  renderedHeight: number,
  naturalWidth: number,
  naturalHeight: number
): Crop {
  const scaleX = renderedWidth / naturalWidth;
  const scaleY = renderedHeight / naturalHeight;

  return {
    unit: 'px',
    x: Math.max(0, cropX * scaleX),
    y: Math.max(0, cropY * scaleY),
    width: Math.max(1, cropWidth * scaleX),
    height: Math.max(1, cropHeight * scaleY),
  };
}

export function buildDefaultCrop(width: number, height: number, aspect: number | undefined): Crop {
  if (!aspect) {
    return { unit: 'px', x: 0, y: 0, width, height };
  }

  return centerCrop(
    makeAspectCrop(
      {
        unit: '%',
        width: 88,
      },
      aspect,
      width,
      height
    ),
    width,
    height
  );
}

export function resolveRenderedImageSize(naturalSize: Size2D, viewportSize: Size2D): Size2D | null {
  if (naturalSize.width <= 0 || naturalSize.height <= 0) {
    return null;
  }

  const maxWidth = Math.max(
    VIEWPORT_MIN_WIDTH_PX,
    viewportSize.width - VIEWPORT_PADDING_PX * 2
  );
  const maxHeight = Math.max(
    VIEWPORT_MIN_HEIGHT_PX,
    viewportSize.height - VIEWPORT_PADDING_PX * 2
  );
  const ratio = Math.min(maxWidth / naturalSize.width, maxHeight / naturalSize.height, 1);

  return {
    width: Math.max(1, Math.round(naturalSize.width * ratio)),
    height: Math.max(1, Math.round(naturalSize.height * ratio)),
  };
}

export function resolveAspect(
  aspectMode: string,
  customRatioInput: string,
  naturalSize: Size2D
): number | undefined {
  if (aspectMode === 'free') {
    return undefined;
  }

  if (aspectMode === 'original') {
    if (naturalSize.width <= 0 || naturalSize.height <= 0) {
      return undefined;
    }
    return naturalSize.width / naturalSize.height;
  }

  if (aspectMode === 'custom') {
    return parseCustomRatio(customRatioInput) ?? undefined;
  }

  return parsePresetRatio(aspectMode) ?? undefined;
}

export function resolveCustomRatioError(aspectMode: string, customRatioInput: string): string | null {
  if (aspectMode !== 'custom') {
    return null;
  }
  if (!customRatioInput.trim()) {
    return '请输入比例，例如 3:2 或 1.5';
  }
  if (!parseCustomRatio(customRatioInput)) {
    return '比例格式无效';
  }
  return null;
}
