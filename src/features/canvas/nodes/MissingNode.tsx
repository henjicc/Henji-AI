import { memo, useMemo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useTranslation } from 'react-i18next';
import { UiError } from '@/components/ui';
import { useCanvasStore } from '@/stores/canvasStore';
import { NodeHeader, NODE_HEADER_FLOATING_POSITION_CLASS } from '../ui/NodeHeader';
import {
  NODE_GENERATION_ERROR_BORDER_CLASS,
  NODE_PORT_NODE_CLASS,
  NODE_PORT_VISIBLE_CLASS,
  NODE_SELECTED_BORDER_CLASS,
  NODE_SURFACE_CLASS,
} from '../ui/nodeControlStyles';

/**
 * 只负责缺失节点的呈现；原始类型、参数、尺寸与连线仍由画布保存。
 * 外壳与其他节点同一套（节点圆角、面板底、选中描边）：原来用浮层卡片 `UiPanel`，带浮层阴影、
 * 选中后没有任何变化，用户看不出是否已选中、能否按删除（任务 5.4）。静息用失败节点的危险描边。
 */
export const MissingNode = memo(function MissingNode({ id, data, width, height, selected }: NodeProps): JSX.Element {
  const { t } = useTranslation();
  const edges = useCanvasStore((state) => state.edges);
  const handles = useMemo(() => [...new Set(edges.flatMap((edge) => [
    ...(edge.source === id ? [`source:${edge.sourceHandle ?? ''}`] : []),
    ...(edge.target === id ? [`target:${edge.targetHandle ?? ''}`] : []),
  ]))], [edges, id]);
  // 画布里没保存尺寸（或为 0 / 非数）时用默认尺寸，否则外壳收缩成一条窄列、几乎点不中（任务 5.4 截图发现）
  const resolvedWidth = typeof width === 'number' && Number.isFinite(width) && width > 0 ? width : 280;
  const resolvedHeight = typeof height === 'number' && Number.isFinite(height) && height > 0 ? height : 160;
  const title = typeof data.displayName === 'string' && data.displayName ? data.displayName : t('node.missing');
  return (
    <div
      className={`group relative flex items-center justify-center rounded-[var(--node-radius)] border ${NODE_SURFACE_CLASS} transition-colors duration-120 ${selected ? NODE_SELECTED_BORDER_CLASS : NODE_GENERATION_ERROR_BORDER_CLASS}`}
      style={{ width: resolvedWidth, height: resolvedHeight }}
      data-missing-node="true"
    >
      <NodeHeader className={NODE_HEADER_FLOATING_POSITION_CLASS} titleText={title} toneClassName="text-danger-text" />
      <UiError className="min-w-0 max-w-full px-4" title={t('node.missing')} message={t('node.missingDescription')} size="xs" />
      {handles.map((key) => {
        const separator = key.indexOf(':');
        const type = key.slice(0, separator) as 'source' | 'target';
        const handleId = key.slice(separator + 1) || undefined;
        return <Handle key={key} id={handleId} type={type} position={type === 'source' ? Position.Right : Position.Left}
          isConnectable={false} className={`${NODE_PORT_NODE_CLASS} ${NODE_PORT_VISIBLE_CLASS} !bg-danger-text`} />;
      })}
    </div>
  );
});
