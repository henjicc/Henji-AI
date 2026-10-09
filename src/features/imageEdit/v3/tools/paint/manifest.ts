import { CircleDashed, Eraser, Paintbrush, PaintBucket, Blend } from 'lucide-react';
import type { ToolManifest } from '../../toolFramework/toolManifest';

const group = { id: 'paint', order: 5 };
const profiles = ['full', 'canvas-edit', 'mask'] as const;
const definitions = [
  { id: 'raster-brush', icon: Paintbrush, shortcut: 'KeyB', description: '在指定像素或蒙版目标绘画，整笔透明度、流量、压感与笔尖参数共用一个内核，完成一次撤销。' },
  { id: 'eraser', icon: Eraser, shortcut: 'KeyE', description: '擦除指定像素或蒙版，保留半透明、压感和整笔撤销。' },
  { id: 'mask-edit', icon: CircleDashed, description: '在当前图层蒙版绘制或擦除，同画笔参数与覆盖内核。' },
  { id: 'paint-gradient', icon: Blend, shortcut: 'KeyG', description: '拖出线性或径向渐变，限制在当前选区内；支持像素与蒙版，取消不提交。' },
  { id: 'paint-fill', icon: PaintBucket, description: '以当前颜色或蒙版值填满当前选区；没有选区时填满目标图层。分块完成后一次撤销。' },
] as const;

declare module '../../toolFramework/types' {
  interface ImageEditorToolCatalog extends Record<typeof definitions[number]['id'], true> {}
}
export const toolManifest: readonly ToolManifest[] = definitions.map(definition => ({ ...definition, group, profiles,
  labelKey: `imageEditor.v3.tools.${definition.id}`, aliases: [definition.id], cursor: 'cursor-crosshair', input: 'overlay' }));
