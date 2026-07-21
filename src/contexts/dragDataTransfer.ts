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

export function setCompactWaveformDragPreview(dataTransfer: DataTransfer, samples?: number[] | null): void {
  const host = getCompactDragPreviewHost();
  host.replaceChildren();
  const canvas = document.createElement('canvas');
  canvas.width = COMPACT_DRAG_PREVIEW_SIZE;
  canvas.height = COMPACT_DRAG_PREVIEW_SIZE;
  canvas.style.display = 'block';
  canvas.style.borderRadius = '8px';
  const context = canvas.getContext('2d');
  if (!context) return;
  const rootStyle = getComputedStyle(document.documentElement);
  const panelRgb = rootStyle.getPropertyValue('--panel-rgb').trim() || '23 23 23';
  const mutedRgb = rootStyle.getPropertyValue('--text-muted-rgb').trim() || '163 163 163';
  context.fillStyle = `rgb(${panelRgb.replaceAll(' ', ', ')})`;
  context.fillRect(0, 0, COMPACT_DRAG_PREVIEW_SIZE, COMPACT_DRAG_PREVIEW_SIZE);
  const bars = samples?.length ? samples : Array.from({ length: 32 }, (_, index) => 0.22 + Math.sin(index * 0.73) ** 2 * 0.56);
  const targetBars = Math.min(32, bars.length);
  const step = bars.length / targetBars;
  context.fillStyle = `rgba(${mutedRgb.replaceAll(' ', ', ')}, 0.78)`;
  for (let index = 0; index < targetBars; index += 1) {
    const amplitude = Math.max(0.08, Math.min(1, bars[Math.floor(index * step)] ?? 0));
    const height = Math.max(3, Math.round(amplitude * 42));
    const x = 7 + index * (50 / targetBars);
    context.fillRect(x, (COMPACT_DRAG_PREVIEW_SIZE - height) / 2, Math.max(1, 36 / targetBars), height);
  }
  host.appendChild(canvas);
  dataTransfer.setDragImage(host, COMPACT_DRAG_PREVIEW_SIZE / 2, COMPACT_DRAG_PREVIEW_SIZE / 2);
}

export function clearCompactDragPreview(): void {
  compactDragPreviewHost?.replaceChildren();
}
