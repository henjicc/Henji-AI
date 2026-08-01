import { Position } from '@xyflow/react';

export const NODE_TOOLBAR_POSITION = Position.Top;
export const NODE_TOOLBAR_ALIGN = 'center' as const;
export const NODE_TOOLBAR_OFFSET = 25;
export const NODE_TOOLBAR_CLASS = 'pointer-events-auto';
export const NODE_TOOLBAR_BUTTON_RADIUS_CLASS = 'rounded-lg';
// 工具栏浮在画布内容之上，交互态继续使用半透明“白纱”，避免出现遮住内容的实心色块。
export const NODE_TOOLBAR_NEUTRAL_BUTTON_CLASS =
  '!border-transparent !bg-transparent text-text-dark hover:!border-veil-subtle hover:!bg-veil-soft hover:!text-text-dark';
export const NODE_TOOLBAR_ACCENT_BUTTON_CLASS =
  '!border-transparent !bg-transparent text-accent hover:!border-accent/45 hover:!bg-accent/15';
export const NODE_TOOLBAR_DANGER_BUTTON_CLASS =
  '!border-transparent !bg-transparent text-red-400 hover:!border-red-500/80 hover:!bg-red-500 hover:!text-white';
