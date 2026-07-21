import type { ReactNode } from 'react';

import { NODE_ROW_CARD_CLASS } from '@/features/canvas/ui/nodeControlStyles';

interface NodeLodPlaceholderProps {
  title: string;
  icon?: ReactNode;
}

/**
 * 低倍率 LOD 占位层：默认 display:none，画布缩放低于内容 LOD 阈值时
 * 由 storyboard.css 的 `.canvas-lod-low .canvas-node-lod-placeholder` 切换为可见。
 * 始终挂在 DOM 里（绝对定位覆盖层），阈值翻转只触发样式重绘、不触发节点重渲染。
 *
 * 视觉上是节点的"简化绘制"：标题行 + 提示词大块 + 两条行卡片骨架，
 * 结构对应真实节点（标题/提示词/参数行），但只有少量纯色圆角块，光栅成本极低。
 */
export function NodeLodPlaceholder({ title, icon }: NodeLodPlaceholderProps): JSX.Element {
  return (
    <div className="canvas-node-lod-placeholder pointer-events-none absolute inset-0 z-10 flex-col gap-1.5 p-2">
      <div className="flex shrink-0 items-center gap-2 px-1 py-0.5 text-text-dark">
        {icon}
        <span className="truncate text-xl font-medium leading-tight">{title}</span>
      </div>
      <div className={`min-h-[48px] flex-1 ${NODE_ROW_CARD_CLASS}`} />
      <div className={`h-9 shrink-0 ${NODE_ROW_CARD_CLASS}`} />
      <div className={`h-9 shrink-0 ${NODE_ROW_CARD_CLASS}`} />
    </div>
  );
}
