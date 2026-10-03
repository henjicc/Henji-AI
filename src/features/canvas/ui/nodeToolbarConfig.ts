import { Position } from '@xyflow/react';

export const NODE_TOOLBAR_POSITION = Position.Top;
export const NODE_TOOLBAR_ALIGN = 'center' as const;
export const NODE_TOOLBAR_OFFSET = 25;
export const NODE_TOOLBAR_CLASS = 'pointer-events-auto';
// 工具条按钮外观由 UiButton 档位决定（quiet 在 .ui-glass 内自动换玻璃纱悬停、不盖实心色块），这里不再登记类串。
