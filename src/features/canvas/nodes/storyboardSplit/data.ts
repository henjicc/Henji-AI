import type { CanvasEdge, CanvasNode, StoryboardFrameItem } from '@/features/canvas/domain/canvasNodes';
import {
  isExportImageNode,
  isImageEditNode,
  isUploadNode,
} from '@/features/canvas/domain/canvasNodes';
import { resolveImageDisplayUrl } from '@/features/canvas/application/imageData';
import { createPromptMediaLabel } from '@/core/inputs/promptDocument';
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

/** 内容相等比较（供 store selector 用，避免上游节点无关字段变化也触发本节点重渲染） */
export function areIncomingImageRefsEqual(a: IncomingImageRef[], b: IncomingImageRef[]): boolean {
  if (a === b) {
    return true;
  }
  if (a.length !== b.length) {
    return false;
  }
  return a.every((item, index) => {
    const other = b[index];
    return item.imageUrl === other.imageUrl && item.previewImageUrl === other.previewImageUrl;
  });
}

export function buildIncomingImageItems(incomingImageRefs: IncomingImageRef[]): IncomingImageItem[] {
  return incomingImageRefs.map((item, index) => ({
    imageUrl: item.imageUrl,
    previewImageUrl: item.previewImageUrl,
    displayUrl: resolveImageDisplayUrl(item.previewImageUrl || item.imageUrl),
    label: createPromptMediaLabel('image', index + 1),
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
