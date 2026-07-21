import { useEffect } from 'react';
import { useUpdateNodeInternals } from '@xyflow/react';

/**
 * 逐行端口的行集合变化时，通知 React Flow 重新测量该节点的 Handle 位置。
 *
 * React Flow 只在节点挂载和显式 updateNodeInternals 时缓存 Handle 坐标；
 * 参数联动（如模式切换新增视频输入行）会让行的增删改变每个端口的纵向位置，
 * 若不重新测量，已有连线会停留在旧坐标上造成错位。
 *
 * signature 由调用方按"当前渲染出的端口集合"拼装，集合不变时不触发重测。
 */
export function useNodeHandlesSync(nodeId: string, signature: string): void {
  const updateNodeInternals = useUpdateNodeInternals();

  useEffect(() => {
    updateNodeInternals(nodeId);
  }, [nodeId, signature, updateNodeInternals]);
}
