import type { CanvasNodeData } from './canvasNodes';
import type { NodeMediaOutput } from './nodePorts';

/** 通用提取：节点 data 上的 imageUrl/previewImageUrl 作为图片输出 */
export function imageOutputsFromData(data: CanvasNodeData): NodeMediaOutput[] {
  const imageUrl = (data as { imageUrl?: DynamicValue }).imageUrl;
  if (typeof imageUrl !== 'string' || !imageUrl) {
    return [];
  }
  const previewImageUrl = (data as { previewImageUrl?: DynamicValue }).previewImageUrl;
  return [{
    kind: 'image',
    url: imageUrl,
    previewUrl: typeof previewImageUrl === 'string' ? previewImageUrl : null,
  }];
}
