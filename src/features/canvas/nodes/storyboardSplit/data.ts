import type { CanvasEdge, CanvasNode, StoryboardFrameItem } from '@/features/canvas/domain/canvasNodes';
import {
  isExportImageNode,
  isImageEditNode,
  isUploadNode,
} from '@/features/canvas/domain/canvasNodes';
import { resolveImageDisplayUrl } from '@/features/canvas/application/imageData';
import type { IncomingImageItem } from './shared';

interface IncomingImageRef {
  imageUrl: string;
  previewImageUrl: string | null;
}

export function collectIncomingImageRefs(
  nodeId: string,
  nodes: CanvasNode[],
  edges: CanvasEdge[]
): IncomingImageRef[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node] as const));
  const sourceNodeIds = edges
    .filter((edge) => edge.target === nodeId)
    .map((edge) => edge.source);

  const dedupedByImageUrl = new Map<string, IncomingImageRef>();
  for (const sourceNodeId of sourceNodeIds) {
    const sourceNode = nodeById.get(sourceNodeId);
    if (!sourceNode) {
      continue;
    }

    if (!isUploadNode(sourceNode) && !isImageEditNode(sourceNode) && !isExportImageNode(sourceNode)) {
      continue;
    }

    const imageUrl = sourceNode.data.imageUrl;
    if (!imageUrl || dedupedByImageUrl.has(imageUrl)) {
      continue;
    }

    dedupedByImageUrl.set(imageUrl, {
      imageUrl,
      previewImageUrl: sourceNode.data.previewImageUrl ?? null,
    });
  }

  return Array.from(dedupedByImageUrl.values());
}

export function buildIncomingImageItems(incomingImageRefs: IncomingImageRef[]): IncomingImageItem[] {
  return incomingImageRefs.map((item, index) => ({
    imageUrl: item.imageUrl,
    previewImageUrl: item.previewImageUrl,
    displayUrl: resolveImageDisplayUrl(item.previewImageUrl || item.imageUrl),
    label: `图${index + 1}`,
  }));
}

export function buildFrameViewerImageList(frames: StoryboardFrameItem[]): string[] {
  return frames
    .map((frame) => {
      const source = frame.imageUrl || frame.previewImageUrl;
      return source ? resolveImageDisplayUrl(source) : null;
    })
    .filter((item): item is string => Boolean(item));
}
