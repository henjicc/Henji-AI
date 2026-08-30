import { createLogger } from '@/core/logging'
import { isDesktopRuntime } from '@/platform/runtime'
import {
  dirname,
  mkdir,
  readFile,
  toDisplaySrc,
} from '@/platform/desktopApi'
import {
  fileToDataUrl,
  inferMimeFromPath,
  saveBase64ToUploads,
  saveBytesToUploads,
} from '@/utils/save'
import type {
  StoryboardImageMetadata,
} from './imageCommandTypes'
import type { PanoramaMetadataReadResult } from '@/platform/contracts/image'

const logger = createLogger('commands.image')
const FILE_URL_PREFIX = 'file://';
const LOCAL_PATH_PATTERN = /^(?:[A-Za-z]:[\\/]|\\\\|\/)/;
export const storyboardMetadataStore = new Map<string, StoryboardImageMetadata>();
export const panoramaMetadataStore = new Map<string, PanoramaMetadataReadResult>();
const IMAGE_CMD_LOG_PREFIX = '[ImageCmd]';
const IMAGE_CMD_LOG_ENABLED = false;

export function isNativeImageRuntime(): boolean {
  return isDesktopRuntime();
}

export function imageCmdInfo(message: string, payload: DynamicValue): void {
  if (!IMAGE_CMD_LOG_ENABLED) return;
  logger.info(`${IMAGE_CMD_LOG_PREFIX} ${message}`, payload);
}

export function imageCmdWarn(message: string, payload: DynamicValue): void {
  if (!IMAGE_CMD_LOG_ENABLED) return;
  logger.warn(`${IMAGE_CMD_LOG_PREFIX} ${message}`, payload);
}

export function normalizeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function throwNativeImageFailure(
  operation: string,
  startedAt: number,
  error: unknown,
  context: DynamicValueMap = {}
): never {
  imageCmdWarn(`${operation} native-failed`, {
    runtime: 'desktop',
    totalMs: Math.round(performance.now() - startedAt),
    error: normalizeErrorMessage(error),
    ...context,
  });
  throw error instanceof Error
    ? error
    : new Error(`${operation} failed: ${String(error)}`);
}

export function sourceKindForLog(source: string): 'data-url' | 'http' | 'blob' | 'local-path' | 'other' {
  if (isDataUrl(source)) return 'data-url';
  if (isHttpUrl(source)) return 'http';
  if (isBlobUrl(source)) return 'blob';
  if (isLikelyLocalPath(source)) return 'local-path';
  return 'other';
}

export function normalizeSourceKey(source: string): string {
  return source.trim();
}

export function isDataUrl(source: string): boolean {
  return source.startsWith('data:');
}

export function isHttpUrl(source: string): boolean {
  return source.startsWith('http://') || source.startsWith('https://');
}

export function isBlobUrl(source: string): boolean {
  return source.startsWith('blob:');
}

export function isLikelyLocalPath(source: string): boolean {
  if (!source) return false;
  if (source.startsWith('asset:') || source.startsWith('tauri:')) return false;
  if (isDataUrl(source) || isHttpUrl(source) || isBlobUrl(source)) return false;
  if (source.startsWith(FILE_URL_PREFIX)) return true;
  return LOCAL_PATH_PATTERN.test(source);
}

export function decodeFileUrl(source: string): string {
  if (!source.startsWith(FILE_URL_PREFIX)) {
    return source;
  }

  try {
    const url = new URL(source);
    const decoded = decodeURIComponent(url.pathname);
    return decoded.replace(/^\/([A-Za-z]:[\\/])/, '$1');
  } catch {
    return source;
  }
}

export function normalizeLocalPath(source: string): string {
  return decodeFileUrl(source.trim());
}

export function extensionToMime(extension: string): string {
  const normalized = extension.replace(/^\./, '').toLowerCase();
  if (normalized === 'jpg' || normalized === 'jpeg') return 'image/jpeg';
  if (normalized === 'webp') return 'image/webp';
  if (normalized === 'gif') return 'image/gif';
  if (normalized === 'bmp') return 'image/bmp';
  if (normalized === 'avif') return 'image/avif';
  return 'image/png';
}

export function mimeToExtension(mime: string): string {
  const normalized = mime.toLowerCase();
  if (normalized.includes('jpeg') || normalized.includes('jpg')) return 'jpg';
  if (normalized.includes('webp')) return 'webp';
  if (normalized.includes('gif')) return 'gif';
  if (normalized.includes('bmp')) return 'bmp';
  if (normalized.includes('avif')) return 'avif';
  return 'png';
}

export function parseDataUrl(dataUrl: string): { mime: string; bytes: Uint8Array } {
  const match = dataUrl.match(/^data:([\w/+.-]+);base64,(.+)$/);
  if (!match) {
    throw new Error('Invalid data URL');
  }
  const [, mime, payload] = match;
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return { mime, bytes };
}

export async function blobToDataUrl(blob: Blob): Promise<string> {
  const reader = new FileReader();
  return await new Promise((resolve, reject) => {
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Blob to DataURL failed'));
    reader.readAsDataURL(blob);
  });
}

export function resolveDisplaySource(source: string): string {
  if (isLikelyLocalPath(source)) {
    return toDisplaySrc(normalizeLocalPath(source));
  }
  return source;
}

export async function loadImageElement(source: string): Promise<HTMLImageElement> {
  const image = new Image();
  const displaySource = resolveDisplaySource(source);
  if (isHttpUrl(displaySource)) {
    image.crossOrigin = 'anonymous';
  }

  return await new Promise((resolve, reject) => {
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('图片加载失败'));
    image.src = displaySource;
  });
}

export function reduceAspectRatio(width: number, height: number): string {
  const safeWidth = Math.max(1, Math.round(width));
  const safeHeight = Math.max(1, Math.round(height));

  let a = safeWidth;
  let b = safeHeight;
  while (b !== 0) {
    const t = b;
    b = a % b;
    a = t;
  }

  const gcd = a || 1;
  return `${Math.round(safeWidth / gcd)}:${Math.round(safeHeight / gcd)}`;
}

export function parseAspectRatio(value: string): number {
  const [wRaw = '1', hRaw = '1'] = value.split(':');
  const w = Number(wRaw);
  const h = Number(hRaw);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    return 1;
  }
  return w / h;
}

export async function sourceToDataUrl(source: string): Promise<string> {
  if (isDataUrl(source)) {
    return source;
  }

  if (isLikelyLocalPath(source)) {
    return await fileToDataUrl(normalizeLocalPath(source));
  }

  const response = await fetch(resolveDisplaySource(source));
  if (!response.ok) {
    throw new Error(`读取图片失败: ${response.status}`);
  }

  const blob = await response.blob();
  return await blobToDataUrl(blob);
}

export async function sourceToBytes(source: string): Promise<{ bytes: Uint8Array; mime: string }> {
  if (isDataUrl(source)) {
    return parseDataUrl(source);
  }

  if (isLikelyLocalPath(source)) {
    const path = normalizeLocalPath(source);
    const bytes = await readFile(path);
    return {
      bytes,
      mime: inferMimeFromPath(path),
    };
  }

  const response = await fetch(resolveDisplaySource(source));
  if (!response.ok) {
    throw new Error(`下载图片失败: ${response.status}`);
  }

  const buffer = await response.arrayBuffer();
  const mime = response.headers.get('content-type') || 'image/png';
  return {
    bytes: new Uint8Array(buffer),
    mime,
  };
}

export async function ensurePathWritable(targetPath: string): Promise<void> {
  const targetDir = await dirname(targetPath);
  await mkdir(targetDir, { recursive: true });
}

export function resolveSafeFilename(input: string): string {
  const fallback = `image-${Date.now()}`;
  const trimmed = input.trim();
  if (!trimmed) return fallback;
  // eslint-disable-next-line no-control-regex
  return trimmed.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
}

export function splitSize(totalSize: number, count: number): number[] {
  const base = Math.floor(totalSize / count);
  const remainder = totalSize % count;
  return Array.from({ length: count }, (_unused, index) => base + (index < remainder ? 1 : 0));
}

export function drawImageWithFit(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
  fit: 'cover' | 'contain'
): void {
  const imageRatio = image.naturalWidth / Math.max(1, image.naturalHeight);
  const targetRatio = dw / Math.max(1, dh);

  if (fit === 'cover') {
    if (imageRatio > targetRatio) {
      const sw = image.naturalHeight * targetRatio;
      const sx = (image.naturalWidth - sw) / 2;
      context.drawImage(image, sx, 0, sw, image.naturalHeight, dx, dy, dw, dh);
      return;
    }

    const sh = image.naturalWidth / targetRatio;
    const sy = (image.naturalHeight - sh) / 2;
    context.drawImage(image, 0, sy, image.naturalWidth, sh, dx, dy, dw, dh);
    return;
  }

  const scale = Math.min(dw / image.naturalWidth, dh / image.naturalHeight);
  const tw = Math.max(1, Math.round(image.naturalWidth * scale));
  const th = Math.max(1, Math.round(image.naturalHeight * scale));
  const tx = dx + (dw - tw) / 2;
  const ty = dy + (dh - th) / 2;
  context.drawImage(image, tx, ty, tw, th);
}

export function trimTextToWidth(
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string {
  const clean = text.trim();
  if (!clean) return '';
  if (context.measureText(clean).width <= maxWidth) return clean;

  let value = clean;
  while (value.length > 1) {
    value = value.slice(0, -1);
    const next = `${value}...`;
    if (context.measureText(next).width <= maxWidth) {
      return next;
    }
  }

  return '...';
}

export async function persistDataUrl(source: string): Promise<string> {
  const saved = await saveBase64ToUploads(source);
  return saved.fullPath;
}

export async function persistBytes(bytes: Uint8Array, mime: string): Promise<string> {
  const saved = await saveBytesToUploads(bytes, mime);
  return saved.fullPath;
}
