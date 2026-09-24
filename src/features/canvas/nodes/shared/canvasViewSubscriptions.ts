import type { CanvasLodLevel } from '@/stores/settingsStore';
import { shouldUseOriginalImageByZoom } from '@/features/canvas/application/imageData';

interface Source<T> {
  getState(): T;
  subscribe(listener: () => void): () => void;
}
export type CanvasViewSource = Source<{ transform: readonly number[]; domNode: HTMLElement | null }>;
type SettingsSource = Source<{ canvasLodLevel: CanvasLodLevel }>;

const CONTENT_LOD_THRESHOLDS: Record<CanvasLodLevel, number | null> = {
  off: null, detail: 0.25, balanced: 0.4, performance: 0.6,
};

/** 同一画布只计算一次公共呈现值；平移不把无变化的值广播到每个节点。 */
export function createCanvasViewSubscriptions(flow: CanvasViewSource, settings: SettingsSource) {
  let subscriberCount = 0;
  let disconnect: (() => void) | undefined;
  let cachedRoot: HTMLElement | null | undefined;
  let cachedPortal: HTMLElement | null = null;
  const connect = () => {
    channels.forEach(channel => channel.refresh());
    const publish = () => channels.forEach(channel => channel.publish());
    const stopFlow = flow.subscribe(publish);
    const stopSettings = settings.subscribe(publish);
    disconnect = () => { stopFlow(); stopSettings(); };
  };

  function channel<T>(getSnapshot: () => T) {
    const listeners = new Set<() => void>();
    let previous: T | undefined = getSnapshot();
    return {
      getSnapshot,
      refresh() { previous = getSnapshot(); },
      clear() { previous = undefined; },
      publish() {
        const next = getSnapshot();
        if (Object.is(next, previous)) return;
        previous = next;
        listeners.forEach(listener => listener());
      },
      subscribe(listener: () => void) {
        // 每次订阅有自己的身份，独立释放；最后一个节点卸载时断开两份源订阅。
        const notify = () => listener();
        listeners.add(notify);
        if (subscriberCount++ === 0) connect();
        return () => {
          if (!listeners.delete(notify)) return;
          if (--subscriberCount === 0) {
            disconnect?.(); disconnect = undefined;
            // ReactFlowProvider 可比工程活得更久，不能借共享投影保留已卸载的整棵 DOM。
            channels.forEach(channel => channel.clear());
            cachedRoot = undefined;
            cachedPortal = null;
          }
        };
      },
    };
  }

  const contentLow = channel(() => {
    const level = settings.getState().canvasLodLevel;
    const threshold = Object.hasOwn(CONTENT_LOD_THRESHOLDS, level)
      ? CONTENT_LOD_THRESHOLDS[level] : CONTENT_LOD_THRESHOLDS.balanced;
    return threshold !== null && flow.getState().transform[2] < threshold;
  });
  const originalImage = channel(() => shouldUseOriginalImageByZoom(flow.getState().transform[2]));
  const viewportPortal = channel(() => {
    const root = flow.getState().domNode;
    if (root !== cachedRoot) {
      cachedRoot = root;
      cachedPortal = root?.querySelector<HTMLElement>('.react-flow__viewport-portal') ?? null;
    }
    return cachedPortal;
  });
  const channels = [contentLow, originalImage, viewportPortal];
  return { contentLow, originalImage, viewportPortal };
}
