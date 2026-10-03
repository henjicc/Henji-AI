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
let compactDragPreviewHost: HTMLDivElement | null = null;

function getCompactDragPreviewHost(): HTMLDivElement {
  if (compactDragPreviewHost) return compactDragPreviewHost;

  const host = document.createElement('div');
  host.style.position = 'fixed';
  host.style.left = '-9999px';
  host.style.top = '-9999px';
  host.style.width = `${COMPACT_DRAG_PREVIEW_SIZE}px`;
  host.style.height = `${COMPACT_DRAG_PREVIEW_SIZE}px`;
  host.style.pointerEvents = 'none';
  document.body.appendChild(host);
  compactDragPreviewHost = host;
  return host;
}

export function setCompactDragPreview(dataTransfer: DataTransfer, previewUrl?: string | null): void {
  if (!previewUrl) return;

  const host = getCompactDragPreviewHost();
  host.replaceChildren();
  const image = document.createElement('img');
  image.src = previewUrl;
  image.draggable = false;
  image.style.display = 'block';
  image.style.width = `${COMPACT_DRAG_PREVIEW_SIZE}px`;
  image.style.height = `${COMPACT_DRAG_PREVIEW_SIZE}px`;
  image.style.objectFit = 'cover';
  image.style.borderRadius = '8px';
  host.appendChild(image);
  dataTransfer.setDragImage(host, COMPACT_DRAG_PREVIEW_SIZE / 2, COMPACT_DRAG_PREVIEW_SIZE / 2);
}

/** 音频拖拽预览：同步绘制（setDragImage 不能等待），用统一波形绘制的迷你档；没有波形数据时只画零线，不伪造内容。 */
export function setCompactWaveformDragPreview(dataTransfer: DataTransfer, waveform?: WaveformData | null): void {
  const host = getCompactDragPreviewHost();
  host.replaceChildren();
  const canvas = document.createElement('canvas');
  canvas.width = COMPACT_DRAG_PREVIEW_SIZE;
  canvas.height = COMPACT_DRAG_PREVIEW_SIZE;
  canvas.style.display = 'block';
  canvas.style.borderRadius = '8px';
  const context = canvas.getContext('2d');
  const lane = document.createElement('canvas');
  lane.width = COMPACT_DRAG_PREVIEW_SIZE - 12;
  lane.height = 42;
  const laneContext = lane.getContext('2d');
  if (!context || !laneContext) return;
  const { colors } = getThemeTokens();
  context.fillStyle = colors.panel;
  context.fillRect(0, 0, COMPACT_DRAG_PREVIEW_SIZE, COMPACT_DRAG_PREVIEW_SIZE);
  const pyramid = waveform?.pyramid;
  drawWaveform(laneContext, {
    width: lane.width, height: lane.height, pixelRatio: 1, ...(waveform ? { data: waveform } : {}), lanes: [0],
    startFrame: (pyramid?.startSeconds ?? 0) * (pyramid?.sampleRate ?? 1), endFrame: (pyramid?.endSeconds ?? 1) * (pyramid?.sampleRate ?? 1),
    tier: 'mini', tone: 'neutral',
    palette: { wave: colors.wave, wavePlayed: colors.wavePlayed, waveCut: colors.waveCut, clipWave: colors.clipWave, line: colors.line, lineStrong: colors.lineStrong },
  });
  context.drawImage(lane, 6, (COMPACT_DRAG_PREVIEW_SIZE - lane.height) / 2);
  host.appendChild(canvas);
  dataTransfer.setDragImage(host, COMPACT_DRAG_PREVIEW_SIZE / 2, COMPACT_DRAG_PREVIEW_SIZE / 2);
}

export function clearCompactDragPreview(): void {
  compactDragPreviewHost?.replaceChildren();
}
