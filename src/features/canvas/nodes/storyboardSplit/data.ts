import type { StoryboardFrameItem } from '@/features/canvas/domain/canvasNodes';
import type { NodeMediaOutput } from '@/features/canvas/domain/nodePorts';
import { resolveImageDisplayUrl } from '@/features/canvas/application/imageData';
import { createPromptMediaLabel } from '@/core/inputs/promptDocument';
import type { IncomingImageItem } from './shared';

export function buildIncomingImageItems(outputs: readonly NodeMediaOutput[]): IncomingImageItem[] {
  return outputs.map((item, index) => ({
    imageUrl: item.url,
    previewImageUrl: item.previewUrl ?? null,
    displayUrl: resolveImageDisplayUrl(item.previewUrl || item.url),
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
