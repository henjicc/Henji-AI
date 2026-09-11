import { CANVAS_NODE_TYPES } from '../domain/canvasNodeConstants';
import type { CanvasNodeType } from '../domain/canvasNodeConstants';
import type { CanvasNodeData } from '../domain/canvasNodes';
import type { ImageNodeSize } from './imageNodeSizing';
import { resolveAspectRatioValue } from './imageNodeSizing';

export const UPLOAD_NODE_DEFAULT_EDGE = 320;
const UPLOAD_NODE_DEFAULT_MAX_EDGE = 640;
const UPLOAD_NODE_MIN_EDGE = 64;
export const UPLOAD_AUDIO_ASPECT_RATIO = '2:1';

export function isUploadNodeType(type: string): boolean {
  return type === CANVAS_NODE_TYPES.universalUpload
    || type === CANVAS_NODE_TYPES.upload
    || type === CANVAS_NODE_TYPES.videoUpload
    || type === CANVAS_NODE_TYPES.audioUpload;
}

/** 按展示面积适配；极端比例限制节点盒，媒体仍由 object-contain 完整显示。 */
export function resolveUploadNodeSize(aspectRatio: string, reference?: ImageNodeSize): ImageNodeSize {
  const hasReference = reference && Number.isFinite(reference.width) && Number.isFinite(reference.height)
    && reference.width > 0 && reference.height > 0;
  const area = hasReference ? reference.width * reference.height : UPLOAD_NODE_DEFAULT_EDGE ** 2;
  const ratio = resolveAspectRatioValue(aspectRatio);
  const maxEdge = hasReference ? 1400 : UPLOAD_NODE_DEFAULT_MAX_EDGE;
  const fit = (value: number) => Math.round(Math.min(maxEdge, Math.max(UPLOAD_NODE_MIN_EDGE, value)));
  return { width: fit(Math.sqrt(area * ratio)), height: fit(Math.sqrt(area / ratio)) };
}

export function resolveUploadNodeDefaultSize(
  type: CanvasNodeType,
  data: Partial<CanvasNodeData>,
): ImageNodeSize | undefined {
  if (!isUploadNodeType(type)) return undefined;
  return resolveUploadNodeSize(type === CANVAS_NODE_TYPES.audioUpload
    ? UPLOAD_AUDIO_ASPECT_RATIO
    : type === CANVAS_NODE_TYPES.universalUpload ? '1:1'
      : 'aspectRatio' in data && typeof data.aspectRatio === 'string' ? data.aspectRatio : '1:1');
}
