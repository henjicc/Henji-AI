import { memo, useLayoutEffect, useRef } from 'react';
import { EdgeLabelRenderer } from '@xyflow/react';
import { mountEdgeFlowPulse, type EdgeFlowRegistration } from './edgeFlowAnimation';

/** 静态 SVG 负责连线/命中；登记到当前画布唯一的流动虚线层。 */
export const EdgeFlowPulse = memo(function EdgeFlowPulse({ path, edgeId }: { path: string; edgeId: string }) {
  const boundsRef = useRef<HTMLDivElement>(null);
  const registrationRef = useRef<EdgeFlowRegistration | null>(null);
  const pathRef = useRef(path);
  pathRef.current = path;
  useLayoutEffect(() => {
    if (!boundsRef.current) return;
    const registration = mountEdgeFlowPulse(boundsRef.current, pathRef.current);
    registrationRef.current = registration;
    return () => { registration(); registrationRef.current = null; };
  }, []);
  // 路径变化只替换缓存，组件卸载才释放共享层，避免单连线拖动反复创建 Canvas。
  useLayoutEffect(() => { registrationRef.current?.update(path); }, [path]);
  return (
    <EdgeLabelRenderer>
      <div ref={boundsRef} aria-hidden="true" data-edge-flow={edgeId} />
    </EdgeLabelRenderer>
  );
});
