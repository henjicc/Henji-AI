import { Scaling } from 'lucide-react';
import type { ToolManifest } from '../../toolFramework/toolManifest';
declare module '../../toolFramework/types' { interface ImageEditorToolCatalog { 'document-size': true } }
export const toolManifest: readonly ToolManifest[] = [{
  id: 'document-size', labelKey: 'imageEditor.v3.tools.document-size', icon: Scaling,
  description: '调整画布边界与九点锚定位置，或重采样图像；内容识别缩放可保护当前选区，先预览再应用，保留可编辑原稿并支持一次撤销。',
  aliases: ['canvas-size', 'image-size', 'content-aware-scale'], group: { id: 'transform', order: 2, collapsed: true, triggerId: 'free-transform' },
  profiles: ['full', 'canvas-edit'], cursor: 'cursor-default', input: 'overlay',
}];
