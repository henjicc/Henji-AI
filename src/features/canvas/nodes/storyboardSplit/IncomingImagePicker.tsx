import { createElement } from 'react';
import type { MenuItem } from '@/hooks/useContextMenu';
import { CanvasNodeImage } from '@/features/canvas/ui/CanvasNodeImage';
import { resolveImageDisplayUrl } from '@/features/canvas/application/imageData';
import type { IncomingImageItem } from './shared';

/**
 * “从输入图片替换”菜单的菜单项（任务 5.9）：菜单本身是共享 `ContextMenu`（贴着格子上的按钮弹出、玻璃表面），
 * 这里只把上游输入图片转成带缩略图的菜单项；没有输入图片时给一条禁用的说明项。
 */
export function buildIncomingImagePickerItems({
  frameId,
  incomingImageItems,
  incomingImageViewerList,
  onReplaceFromInput,
}: {
  frameId: string;
  incomingImageItems: IncomingImageItem[];
  incomingImageViewerList: string[];
  onReplaceFromInput: (frameId: string, imageUrl: string) => void;
}): MenuItem[] {
  if (incomingImageItems.length === 0) {
    return [{ id: 'empty', label: '暂无输入图片', icon: null, disabled: true, onClick: () => {} }];
  }
  return incomingImageItems.map((item) => ({
    id: `${frameId}-${item.imageUrl}`,
    label: item.label,
    title: item.label,
    icon: createElement(CanvasNodeImage, {
      src: item.displayUrl,
      alt: item.label,
      viewerSourceUrl: resolveImageDisplayUrl(item.imageUrl),
      viewerImageList: incomingImageViewerList,
      className: 'h-6 w-6 rounded-control object-cover',
      draggable: false,
    }),
    onClick: () => onReplaceFromInput(frameId, item.imageUrl),
  }));
}
