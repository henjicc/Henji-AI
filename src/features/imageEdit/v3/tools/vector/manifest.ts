import { ArrowUpRight, Circle, PenTool, RectangleHorizontal, Type, MessageSquareText, ListOrdered } from 'lucide-react';
import type { ToolManifest } from '../../toolFramework/toolManifest';
const profiles = ['full', 'quick', 'canvas-edit'] as const;
const group = { id: 'vector', order: 4, collapsed: true, labelKey: 'imageEditor.v3.tools.annotation', triggerId: 'vector' };
const specs = {
  'vector-text': { icon: Type, cursor: 'cursor-text', shortcut: 'KeyT' },
  'vector-rectangle': { icon: RectangleHorizontal, cursor: 'cursor-crosshair' },
  'vector-ellipse': { icon: Circle, cursor: 'cursor-crosshair' },
  'vector-arrow': { icon: ArrowUpRight, cursor: 'cursor-crosshair' },
  'vector-callout': { icon: MessageSquareText, cursor: 'cursor-crosshair' },
  'vector-number': { icon: ListOrdered, cursor: 'cursor-text' },
  'vector-path': { icon: PenTool, cursor: 'cursor-crosshair', shortcut: 'KeyP' },
} as const;
declare module '../../toolFramework/types' { interface ImageEditorToolCatalog extends Record<keyof typeof specs, true> {} }
export const toolManifest: readonly ToolManifest[] = (Object.keys(specs) as Array<keyof typeof specs>).map(id => ({
  ...specs[id], id, group, profiles, input: 'overlay', labelKey: `imageEditor.v3.tools.${id}`, description: '在当前文档创建可编辑文字、形状或路径图层；一次确认写入一个撤销步骤。', aliases: [id],
}));
