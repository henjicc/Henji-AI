import { useStoreApi } from '@xyflow/react';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';
import { useSettingsStore } from '@/stores/settingsStore';
import type { CanvasEdge, CanvasNode } from '@/features/canvas/domain/canvasNodes';
import { canvasEventBus } from '@/features/canvas/application/canvasServices';
import { resolveCanvasDetailZoomThreshold } from '@/features/canvas/nodes/shared/canvasViewSubscriptions';
import { useCanvasSceneView } from '@/features/canvas/scene/useCanvasScene';
import { createCanvasNodePresence, type CanvasNodeBodyMode, type CanvasNodePresence, type CanvasNodePresenceSource } from './canvasNodePresence';

const instances = new WeakMap<CanvasNodePresenceSource['getState'], CanvasNodePresence>();
/** 当前挂载着的画布的调度：供不在画布组件树里的调用方判断某个节点的正文看不看得见 */
let activePresence: CanvasNodePresence | null = null;

/** 这个节点的正文此刻是否看得见；没有画布挂着时按看得见算（小画布上全部节点都挂着正文）。 */
export function isCanvasNodeBodyVisible(nodeId: string): boolean {
  return activePresence?.isBodyInteractive(nodeId) ?? true;
}

/** 导入文件由节点组件接住后立即开始处理：正文保持挂载这么久，够它把结果写回节点数据 */
const NODE_IMPORT_PIN_MS = 15_000;
/** 重新上传要等用户在系统对话框里选文件，选多久都得接得住 */
const NODE_REUPLOAD_PIN_MS = 10 * 60_000;

/** 同一个 ReactFlow store 共用一份调度；useStoreApi 每次返回新包装，getState 才是稳定标识。 */
export function useCanvasNodePresence(): CanvasNodePresence {
  const source = useStoreApi<CanvasNode, CanvasEdge>();
  const { scene } = useCanvasSceneView();
  let presence = instances.get(source.getState);
  if (!presence) {
    const { getState, setState, subscribe } = source;
    presence = createCanvasNodePresence({
      scene,
      getState,
      subscribe,
      // 渲染名单是补丁加在 ReactFlow store 上的字段，不在它的类型里
      setState: ids => setState(ids as Partial<ReturnType<typeof getState>>),
      // 就地改当前状态对象、不触发订阅：此时节点层还没渲染，下一次 set 会带着这两个字段一起复制
      seed: ids => { Object.assign(getState(), ids); },
    }, {
      getZoomThreshold: () => resolveCanvasDetailZoomThreshold(useSettingsStore.getState().canvasLodLevel),
      commit: apply => flushSync(apply),
    });
    instances.set(source.getState, presence);
  }
  return presence;
}

/** 这个节点现在的形态（关、壳、正文）。 */
export function useCanvasNodeBodyMode(id: string): CanvasNodeBodyMode {
  const source = useStoreApi();
  const subscribe = useCallback(
    (listener: () => void) => instances.get(source.getState)?.subscribe(id, listener) ?? (() => undefined),
    [id, source.getState],
  );
  return useSyncExternalStore(subscribe, () => instances.get(source.getState)?.modeOf(id) ?? 'body');
}

export type CanvasFarView = 'unavailable' | 'far' | 'near';

/**
 * 画布外壳用：开启正文挂载调度，并返回当前处于远景还是近景。
 * 开启动作放在渲染阶段（惰性初始值），这样同一次渲染里的节点一开始就只出空块，不会先把全部正文挂上。
 */
export function useCanvasFarView(): CanvasFarView {
  const presence = useCanvasNodePresence();
  useState(() => { presence.arm(); return null; });
  useEffect(() => {
    presence.arm();
    activePresence = presence;
    // 这些操作由节点组件自己接住，正文没挂着就会落空：先把它挂上。
    // pin 同步挂载正文，正文在挂载时订阅同一事件；事件总线派发时现场遍历订阅集合，所以它收得到正在派发的这一条。
    const stopEvents = [
      canvasEventBus.subscribe('canvas/import-media', ({ nodeId }) => presence.pin(nodeId, NODE_IMPORT_PIN_MS)),
      canvasEventBus.subscribe('upload-node/reupload', ({ nodeId }) => presence.pin(nodeId, NODE_REUPLOAD_PIN_MS)),
    ];
    return () => {
      stopEvents.forEach(stopEvent => stopEvent());
      if (activePresence === presence) activePresence = null;
      presence.disarm();
    };
  }, [presence]);
  return useSyncExternalStore(
    presence.subscribeState,
    () => (!presence.isEnabled() ? 'unavailable' : presence.isNear() ? 'near' : 'far'),
  );
}
