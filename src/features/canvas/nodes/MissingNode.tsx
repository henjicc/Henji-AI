import { memo, useMemo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useTranslation } from 'react-i18next';
import { UiError, UiPanel } from '@/components/ui';
import { useCanvasStore } from '@/stores/canvasStore';
import { NodeHeader, NODE_HEADER_FLOATING_POSITION_CLASS } from '../ui/NodeHeader';
import { NODE_PORT_NODE_CLASS, NODE_PORT_VISIBLE_CLASS } from '../ui/nodeControlStyles';

/** 只负责缺失节点的呈现；原始类型、参数、尺寸与连线仍由工程保存。 */
export const MissingNode = memo(function MissingNode({ id, data, width, height }: NodeProps): JSX.Element {
  const { t } = useTranslation();
  const edges = useCanvasStore((state) => state.edges);
  const handles = useMemo(() => [...new Set(edges.flatMap((edge) => [
    ...(edge.source === id ? [`source:${edge.sourceHandle ?? ''}`] : []),
    ...(edge.target === id ? [`target:${edge.targetHandle ?? ''}`] : []),
  ]))], [edges, id]);
  const title = typeof data.displayName === 'string' && data.displayName ? data.displayName : t('node.missing');
  return (
    <UiPanel className="group relative flex items-center justify-center !border-danger text-danger"
      style={{ width: width ?? 280, height: height ?? 160 }} data-missing-node="true">
      <NodeHeader className={NODE_HEADER_FLOATING_POSITION_CLASS} titleText={title} toneClassName="text-danger" />
      <UiError className="min-w-0 max-w-full px-4" title={t('node.missing')} message={t('node.missingDescription')} size="xs" />
      {handles.map((key) => {
        const separator = key.indexOf(':');
        const type = key.slice(0, separator) as 'source' | 'target';
        const handleId = key.slice(separator + 1) || undefined;
        return <Handle key={key} id={handleId} type={type} position={type === 'source' ? Position.Right : Position.Left}
          isConnectable={false} className={`${NODE_PORT_NODE_CLASS} ${NODE_PORT_VISIBLE_CLASS} !bg-danger`} />;
      })}
    </UiPanel>
  );
});
