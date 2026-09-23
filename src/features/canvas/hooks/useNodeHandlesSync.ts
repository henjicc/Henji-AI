import { useEffect } from 'react';
import { useStoreApi, useUpdateNodeInternals } from '@xyflow/react';

interface MeasurementBatch {
  requests: Map<symbol, string>;
  update: (ids: string[]) => void;
}

// getState 是底层 store 的稳定身份；useStoreApi 自身的包装对象在不同 hook 中不相同。
const pendingMeasurements = new WeakMap<object, MeasurementBatch>();

function scheduleMeasurement(store: object, nodeId: string, update: MeasurementBatch['update']): () => void {
  let batch = pendingMeasurements.get(store);
  if (!batch) {
    batch = { requests: new Map(), update };
    pendingMeasurements.set(store, batch);
    const queued = batch;
    // 合并本轮 React 提交，仍由 ReactFlow 在下一帧测量真实 DOM；不额外等待一帧。
    queueMicrotask(() => {
      pendingMeasurements.delete(store);
      const ids = [...new Set(queued.requests.values())];
      if (ids.length) queued.update(ids);
    });
  }
  const token = Symbol(nodeId);
  batch.requests.set(token, nodeId);
  return () => { batch.requests.delete(token); };
}

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
  const { getState } = useStoreApi();

  useEffect(() => scheduleMeasurement(getState, nodeId, updateNodeInternals),
    [getState, nodeId, signature, updateNodeInternals]);
}
