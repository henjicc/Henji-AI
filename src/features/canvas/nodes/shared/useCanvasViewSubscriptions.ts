import { useStoreApi } from '@xyflow/react';
import { useSyncExternalStore } from 'react';
import { useSettingsStore } from '@/stores/settingsStore';
import { createCanvasViewSubscriptions, type CanvasViewSource } from './canvasViewSubscriptions';

const subscriptions = new WeakMap<CanvasViewSource['getState'], ReturnType<typeof createCanvasViewSubscriptions>>();

export function useCanvasViewSubscriptions() {
  const source = useStoreApi();
  // useStoreApi 在各组件中返回不同包装对象，getState 才是同一 ReactFlow store 的稳定标识。
  let shared = subscriptions.get(source.getState);
  if (!shared) {
    shared = createCanvasViewSubscriptions(source, useSettingsStore);
    subscriptions.set(source.getState, shared);
  }
  return shared;
}

export function useCanvasViewportPortal(): HTMLElement | null {
  const { viewportPortal } = useCanvasViewSubscriptions();
  return useSyncExternalStore(viewportPortal.subscribe, viewportPortal.getSnapshot);
}
