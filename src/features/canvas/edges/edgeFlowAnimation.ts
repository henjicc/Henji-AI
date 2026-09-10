import { EdgeFlowCanvas } from './edgeFlowCanvas';

const layers = new WeakMap<HTMLElement, EdgeFlowCanvas>();

export type EdgeFlowRegistration = (() => number) & { update: (path: string) => void };

/** 所有生成连线共用一个绘制层；React 只登记路径变化，不参与动画帧。 */
export function mountEdgeFlowPulse(anchor: HTMLDivElement, path: string, initialPhase = 0): EdgeFlowRegistration {
  const flow = anchor.closest<HTMLElement>('.react-flow');
  const viewport = flow?.querySelector<HTMLElement>('.react-flow__viewport');
  const pane = flow?.querySelector<HTMLElement>('.react-flow__pane');
  if (!flow || !viewport || !pane) return Object.assign(() => initialPhase, { update: (_path: string) => {} });
  let layer = layers.get(flow);
  if (!layer) {
    layer = new EdgeFlowCanvas(flow, pane, viewport);
    layers.set(flow, layer);
  }
  layer.add(anchor, path);
  const activeLayer = layer;
  let disposed = false;
  let currentPath = path;
  return Object.assign(() => {
    if (disposed) return 0;
    disposed = true;
    activeLayer.remove(anchor);
    if (activeLayer.size === 0) {
      activeLayer.dispose();
      layers.delete(flow);
    }
    // 虚线以共享时钟播放；端点更新不重置各段相位。
    return 0;
  }, { update: (nextPath: string) => {
    if (disposed || nextPath === currentPath) return;
    currentPath = nextPath;
    activeLayer.add(anchor, nextPath);
  } });
}

/** 只读开发诊断，真实 Electron 基准复用正式绘制层。 */
export function readEdgeFlowDiagnostics(flow: HTMLElement) {
  return layers.get(flow)?.diagnostics() ?? null;
}
