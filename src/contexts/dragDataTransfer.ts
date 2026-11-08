import { getThemeTokens } from '@/core/theme/themeTokenStore';
import { drawWaveform } from '@/components/waveform/waveformDraw';
import type { WaveformData } from '@/services/waveform/waveformDataService';

export const HENJI_DRAG_DATA_MIME = 'application/x-henji-drag-data';

export interface HenjiDragTransferData {
  type: 'image' | 'video' | 'audio';
  imageUrl: string;
  filePath?: string;
  sourceType: 'history' | 'upload' | 'asset';
  assetId?: string;
  displayName?: string;
  thumbnailUrl?: string | null;
  aspectRatio?: string;
  durationSeconds?: number | null;
}

function isDragTransferData(value: unknown): value is HenjiDragTransferData {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const record = value as Record<string, unknown>;
  const type = record.type;
  const imageUrl = record.imageUrl;
  const sourceType = record.sourceType;
  return (
    (type === 'image' || type === 'video' || type === 'audio') &&
    typeof imageUrl === 'string' &&
    (sourceType === 'history' || sourceType === 'upload' || sourceType === 'asset') &&
    (record.assetId === undefined || typeof record.assetId === 'string') &&
    (record.displayName === undefined || typeof record.displayName === 'string') &&
    (record.thumbnailUrl === undefined || record.thumbnailUrl === null || typeof record.thumbnailUrl === 'string') &&
    (record.aspectRatio === undefined || typeof record.aspectRatio === 'string') &&
    (record.durationSeconds === undefined || record.durationSeconds === null || typeof record.durationSeconds === 'number') &&
    (record.filePath === undefined || typeof record.filePath === 'string')
  );
}

export function writeHenjiDragData(dataTransfer: DataTransfer, data: HenjiDragTransferData): void {
  dataTransfer.setData(HENJI_DRAG_DATA_MIME, JSON.stringify(data));
}

export function readHenjiDragData(dataTransfer: DataTransfer): HenjiDragTransferData | null {
  const rawData = dataTransfer.getData(HENJI_DRAG_DATA_MIME);
  if (!rawData) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(rawData);
    return isDragTransferData(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

const COMPACT_DRAG_PREVIEW_SIZE = 64;
/** 图片与视频的拖拽缩略图按 3:4 竖幅，与参考素材卡一致；音频波形仍是方块。 */
const COMPACT_DRAG_PREVIEW_WIDTH = 48;
/** 缩略图放在光标右下方（避开系统“复制”角标），不挡住光标下的落点，比如提示词里的插入竖线。 */
const DRAG_PREVIEW_OFFSET = { x: 28, y: 12 };
const DRAG_PREVIEW_RADIUS = 8;
let compactDragPreviewHost: HTMLDivElement | null = null;
/** 拖过一次的地址留着已解码的图，下次直接画。 */
const decodedPreviews = new Map<string, HTMLImageElement>();

function getCompactDragPreviewHost(): HTMLDivElement {
  if (compactDragPreviewHost) return compactDragPreviewHost;

  const host = document.createElement('div');
  host.style.position = 'fixed';
  host.style.left = '-9999px';
  host.style.top = '-9999px';
  host.style.pointerEvents = 'none';
  document.body.appendChild(host);
  compactDragPreviewHost = host;
  return host;
}

function isDecoded(image: HTMLImageElement | undefined): image is HTMLImageElement {
  return Boolean(image?.complete && image.naturalWidth > 0);
}

/**
 * setDragImage 只能在 dragstart 当下同步截图：临时新建的 img 还没解码，第一次拖动就是空白。
 * 所以只用已经解码好的图——页面上正显示着的同一张，或之前拖过留下的——同步画进画布；都没有时预载，下次就有。
 */
function findDecodedPreview(url: string): HTMLImageElement | null {
  const cached = decodedPreviews.get(url);
  if (isDecoded(cached)) return cached;
  const href = new URL(url, document.baseURI).href;
  const onScreen = Array.from(document.images).find(image => (image.currentSrc === href || image.src === href) && isDecoded(image));
  if (onScreen) return onScreen;
  if (!cached) {
    const image = new Image();
    image.src = url;
    decodedPreviews.set(url, image);
  }
  return null;
}

/** 画布按光标偏移留出左上空白，内容画在右下；返回绘制区域的 2D 上下文（已按设备像素比缩放并裁成圆角）。 */
function createDragPreviewCanvas(width: number, height: number): { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D | null } {
  const ratio = window.devicePixelRatio || 1;
  const canvas = document.createElement('canvas');
  const cssWidth = DRAG_PREVIEW_OFFSET.x + width;
  const cssHeight = DRAG_PREVIEW_OFFSET.y + height;
  canvas.width = Math.round(cssWidth * ratio);
  canvas.height = Math.round(cssHeight * ratio);
  canvas.style.display = 'block';
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  const context = canvas.getContext('2d');
  if (context) {
    context.scale(ratio, ratio);
    context.translate(DRAG_PREVIEW_OFFSET.x, DRAG_PREVIEW_OFFSET.y);
    context.beginPath();
    context.roundRect(0, 0, width, height, DRAG_PREVIEW_RADIUS);
    context.clip();
  }
  return { canvas, context };
}

function showDragPreview(dataTransfer: DataTransfer, canvas: HTMLCanvasElement): void {
  const host = getCompactDragPreviewHost();
  host.replaceChildren(canvas);
  dataTransfer.setDragImage(host, 0, 0);
}

export function setCompactDragPreview(dataTransfer: DataTransfer, previewUrl?: string | null): void {
  if (!previewUrl) return;

  const width = COMPACT_DRAG_PREVIEW_WIDTH;
  const height = COMPACT_DRAG_PREVIEW_SIZE;
  const { canvas, context } = createDragPreviewCanvas(width, height);
  if (!context) return;
  const image = findDecodedPreview(previewUrl);
  if (image) {
    // 等比铺满 3:4 卡片，居中裁切
    const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
    const drawWidth = image.naturalWidth * scale;
    const drawHeight = image.naturalHeight * scale;
    context.drawImage(image, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
  } else {
    context.fillStyle = getThemeTokens().colors.raised;
    context.fillRect(0, 0, width, height);
  }
  showDragPreview(dataTransfer, canvas);
}

/** 音频拖拽预览：同步绘制（setDragImage 不能等待），用统一波形绘制的迷你档；没有波形数据时只画零线，不伪造内容。 */
export function setCompactWaveformDragPreview(dataTransfer: DataTransfer, waveform?: WaveformData | null): void {
  const size = COMPACT_DRAG_PREVIEW_SIZE;
  const { canvas, context } = createDragPreviewCanvas(size, size);
  const lane = document.createElement('canvas');
  lane.width = size - 12;
  lane.height = 42;
  const laneContext = lane.getContext('2d');
  if (!context || !laneContext) return;
  const { colors } = getThemeTokens();
  context.fillStyle = colors.panel;
  context.fillRect(0, 0, size, size);
  const pyramid = waveform?.pyramid;
  drawWaveform(laneContext, {
    width: lane.width, height: lane.height, pixelRatio: 1, ...(waveform ? { data: waveform } : {}), lanes: [0],
    startFrame: (pyramid?.startSeconds ?? 0) * (pyramid?.sampleRate ?? 1), endFrame: (pyramid?.endSeconds ?? 1) * (pyramid?.sampleRate ?? 1),
    tier: 'mini', tone: 'neutral',
    palette: { wave: colors.wave, wavePlayed: colors.wavePlayed, waveCut: colors.waveCut, clipWave: colors.clipWave, line: colors.line, lineStrong: colors.lineStrong },
  });
  context.drawImage(lane, 6, (size - lane.height) / 2);
  showDragPreview(dataTransfer, canvas);
}

export function clearCompactDragPreview(): void {
  compactDragPreviewHost?.replaceChildren();
}
