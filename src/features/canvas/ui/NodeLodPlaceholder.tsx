import type { ReactNode } from 'react';

interface NodeLodPlaceholderProps {
  title: string;
  icon?: ReactNode;
}

/**
 * 低倍率 LOD 占位层：默认 display:none，画布缩放低于内容 LOD 阈值时
 * 由 storyboard.css 的 `.canvas-lod-low .canvas-node-lod-placeholder` 切换为可见。
 * 始终挂在 DOM 里（绝对定位覆盖层），阈值翻转只触发样式重绘、不触发节点重渲染。
 */
export function NodeLodPlaceholder({ title, icon }: NodeLodPlaceholderProps): JSX.Element {
  return (
    <div className="canvas-node-lod-placeholder pointer-events-none absolute inset-0 z-10 flex-col items-center justify-center gap-2 p-4 text-text-muted">
      {icon}
      <span className="line-clamp-2 max-w-full break-words text-center text-[26px] font-medium leading-snug">
        {title}
      </span>
    </div>
  );
}
