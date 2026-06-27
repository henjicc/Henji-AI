export const HENJI_DRAG_DATA_MIME = 'application/x-henji-drag-data';

export interface HenjiDragTransferData {
  type: 'image' | 'video' | 'audio';
  imageUrl: string;
  filePath?: string;
  sourceType: 'history' | 'upload';
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
    (sourceType === 'history' || sourceType === 'upload') &&
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
