import { memo, useLayoutEffect, useRef } from 'react';
import { EdgeLabelRenderer } from '@xyflow/react';
import { mountEdgeFlowPulse } from './edgeFlowAnimation';

/** 静态 SVG 负责连线/命中；登记到当前画布唯一的流动虚线层。 */
export const EdgeFlowPulse = memo(function EdgeFlowPulse({ path, edgeId }: { path: string; edgeId: string }) {
  const boundsRef = useRef<HTMLDivElement>(null);
  const phaseRef = useRef(0);
  useLayoutEffect(() => {
    if (!boundsRef.current) return;
    const dispose = mountEdgeFlowPulse(boundsRef.current, path, phaseRef.current);
    // 拖动端点重建路径时保留运动相位，避免每次都从源头闪回。
    return () => { phaseRef.current = dispose(); };
  }, [path]);
  return (
    <EdgeLabelRenderer>
      <div ref={boundsRef} aria-hidden="true" data-edge-flow={edgeId} />
    </EdgeLabelRenderer>
  );
});
