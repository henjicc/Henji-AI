import { Expand } from 'lucide-react';
import type { ToolManifest } from '../../toolFramework/toolManifest';
declare module '../../toolFramework/types' { interface ImageEditorToolCatalog { 'ai-outpaint': true } }
export const toolManifest: readonly ToolManifest[] = [{ id: 'ai-outpaint', icon: Expand, labelKey: 'imageEditor.v3.tools.ai-outpaint',
  description: '按原画幅比例向右或下方扩展画面，AI 先补边缘，原图保留，结果作为带蒙版的智能对象层可调整或撤销。按模型计费，提交前确认。',
  aliases: ['扩图', '拓展画面', 'outpaint'], group: { id: 'repair', order: 3, collapsed: true, labelKey: 'imageEditor.v3.retouch.group' },
  profiles: ['full', 'canvas-edit'], cursor: 'cursor-default', input: 'overlay' }];
