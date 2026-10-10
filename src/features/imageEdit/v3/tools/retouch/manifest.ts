import { Stamp, Bandage, ScanLine } from 'lucide-react';
import type { ToolManifest } from '../../toolFramework/toolManifest';

const definitions = [
  { id: 'clone-stamp', icon: Stamp, shortcut: 'KeyS', description: 'Alt 点击干净来源，连续复制笔前纹理；对齐时跨笔保持供体偏移，不对齐时每笔从取样点重新开始。' },
  { id: 'healing-brush', icon: Bandage, shortcut: 'KeyJ', description: 'Alt 取样后刷过瑕疵，复制纹理并融合目标明暗；选区限制、流量与整笔透明度共用画笔，一笔一次撤销。' },
  { id: 'content-aware-fill', icon: ScanLine, description: '从选区外干净背景搜索纹理，填补当前选区，预览后确认；失败或取消保留原图。' },
] as const;
declare module '../../toolFramework/types' {
  interface ImageEditorToolCatalog extends Record<typeof definitions[number]['id'], true> {}
}
export const toolManifest: readonly ToolManifest[] = definitions.map(definition => ({ ...definition,
  group: { id: 'repair', order: 3, collapsed: true, labelKey: 'imageEditor.v3.retouch.group' }, profiles: ['full', 'canvas-edit'],
  labelKey: `imageEditor.v3.tools.${definition.id}`, aliases: [definition.id], cursor: 'cursor-crosshair', input: 'overlay', requiresRasterTarget: true }));
