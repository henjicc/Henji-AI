/** @vitest-environment jsdom */
import { expect, it, vi } from 'vitest';
import { createStore } from 'zustand/vanilla';
import { createElement, type PropsWithChildren } from 'react';
import { act, renderHook } from '@testing-library/react';
import { ReactFlowProvider, useStoreApi } from '@xyflow/react';
import { useSettingsStore, type CanvasLodLevel } from '@/stores/settingsStore';
import { createCanvasViewSubscriptions } from './canvasViewSubscriptions';
import { useCanvasViewportPortal, useCanvasViewSubscriptions } from './useCanvasViewSubscriptions';
import { useCanvasContentLod, useMediaMicroLod } from './useCanvasContentLod';
import { useOriginalImageLod } from './useOriginalImageLod';

function fixture() {
  const flow = createStore(() => ({ transform: [0, 0, 0.5], domNode: null as HTMLElement | null }));
  const settings = createStore(() => ({ canvasLodLevel: 'balanced' as CanvasLodLevel }));
  const shared = createCanvasViewSubscriptions(flow, settings);
  return { flow, settings, shared };
}

it('三千个公共值订阅只连接一份源；平移零通知，全部释放后断开，重订阅读取最新值', () => {
  const { flow, settings, shared } = fixture();
  const stopFlow = vi.fn(), stopSettings = vi.fn();
  const flowSubscribe = flow.subscribe, settingsSubscribe = settings.subscribe;
  const subscribeFlow = vi.spyOn(flow, 'subscribe').mockImplementation(listener => {
    const stop = flowSubscribe(listener);
    return () => { stop(); stopFlow(); };
  });
  const subscribeSettings = vi.spyOn(settings, 'subscribe').mockImplementation(listener => {
    const stop = settingsSubscribe(listener);
    return () => { stop(); stopSettings(); };
  });
  const notify = vi.fn();
  const stops = Array.from({ length: 1000 }, () => Object.values(shared).map(channel => channel.subscribe(notify))).flat();
  expect(subscribeFlow).toHaveBeenCalledTimes(1);
  expect(subscribeSettings).toHaveBeenCalledTimes(1);
  for (let i = 0; i < 120; i++) flow.setState({ transform: [i * 9, i * -2, 0.5] });
  expect(notify).not.toHaveBeenCalled();
  flow.setState({ transform: [100, 90, 0.3] });
  expect(notify).toHaveBeenCalledTimes(1000);
  stops.forEach(stop => { stop(); stop(); });
  expect(stopFlow).toHaveBeenCalledTimes(1);
  expect(stopSettings).toHaveBeenCalledTimes(1);
  flow.setState({ transform: [100, 90, 2] });
  const next = vi.fn();
  const stop = shared.originalImage.subscribe(next);
  expect(shared.originalImage.getSnapshot()).toBe(true);
  flow.setState({ transform: [100, 90, 0.3] });
  expect(next).toHaveBeenCalledTimes(1);
  stop();
  expect(subscribeFlow).toHaveBeenCalledTimes(2);
  expect(stopFlow).toHaveBeenCalledTimes(2);
});

it('内容档位、原图档位和宿主分别通知，关闭简化不因空值回退再次启用', () => {
  const { flow, settings, shared } = fixture();
  const content = vi.fn(), original = vi.fn(), root = vi.fn();
  const stops = [shared.contentLow.subscribe(content), shared.originalImage.subscribe(original), shared.viewportPortal.subscribe(root)];
  for (const [level, boundary] of [['detail', 0.25], ['balanced', 0.4], ['performance', 0.6]] as const) {
    settings.setState({ canvasLodLevel: level });
    flow.setState({ transform: [0, 0, boundary] });
    expect(shared.contentLow.getSnapshot()).toBe(false);
    flow.setState({ transform: [0, 0, boundary - 0.01] });
    expect(shared.contentLow.getSnapshot()).toBe(true);
  }
  settings.setState({ canvasLodLevel: 'off' });
  flow.setState({ transform: [0, 0, 0.1] });
  expect(shared.contentLow.getSnapshot()).toBe(false);
  expect(original).not.toHaveBeenCalled();
  flow.setState({ transform: [0, 0, 2] });
  expect(original).toHaveBeenCalledTimes(1);
  expect(root).not.toHaveBeenCalled();
  const element = document.createElement('div');
  const portal = document.createElement('div');
  portal.className = 'react-flow__viewport-portal';
  element.appendChild(portal);
  flow.setState({ domNode: element });
  expect(shared.viewportPortal.getSnapshot()).toBe(portal);
  expect(root).toHaveBeenCalledTimes(1);
  flow.setState({ domNode: null });
  expect(root).toHaveBeenCalledTimes(2);
  stops.forEach(stop => stop());
});

it('不同画布的缩放与宿主相互隔离', () => {
  const a = fixture(), b = fixture();
  const notifyA = vi.fn(), notifyB = vi.fn();
  const stopA = a.shared.contentLow.subscribe(notifyA), stopB = b.shared.contentLow.subscribe(notifyB);
  a.flow.setState({ transform: [0, 0, 0.2] });
  expect(notifyA).toHaveBeenCalledOnce();
  expect(notifyB).not.toHaveBeenCalled();
  expect(b.shared.contentLow.getSnapshot()).toBe(false);
  stopA(); stopB();
});

it('正式 ReactFlow hooks 共用同一投影，响应设置、缩放和根容器更新，平移不重渲染', () => {
  const previousLevel = useSettingsStore.getState().canvasLodLevel;
  useSettingsStore.setState({ canvasLodLevel: 'balanced' });
  let renders = 0;
  const view = renderHook(() => {
    renders++;
    return { flow: useStoreApi(), a: useCanvasViewSubscriptions(), b: useCanvasViewSubscriptions(),
      low: useCanvasContentLod(), micro: useMediaMicroLod(), original: useOriginalImageLod(), portal: useCanvasViewportPortal() };
  }, { wrapper: ({ children }: PropsWithChildren) => createElement(ReactFlowProvider, null, children) });
  try {
    expect(view.result.current.a).toBe(view.result.current.b);
    act(() => view.result.current.flow.setState({ transform: [0, 0, 0.3] }));
    expect(view.result.current.low).toBe(true);
    expect(view.result.current.micro).toBe(true);
    const beforePan = renders;
    for (let i = 1; i <= 30; i++) act(() => view.result.current.flow.setState({ transform: [i, -i, 0.3] }));
    expect(renders).toBe(beforePan);
    act(() => useSettingsStore.setState({ canvasLodLevel: 'off' }));
    expect(view.result.current.low).toBe(false);
    expect(view.result.current.micro).toBe(false);
    act(() => view.result.current.flow.setState({ transform: [0, 0, 2] }));
    expect(view.result.current.original).toBe(true);
    const root = document.createElement('div');
    const portal = document.createElement('div');
    portal.className = 'react-flow__viewport-portal';
    root.appendChild(portal);
    act(() => view.result.current.flow.setState({ domNode: root }));
    expect(view.result.current.portal).toBe(portal);
  } finally {
    view.unmount();
    useSettingsStore.setState({ canvasLodLevel: previousLevel });
  }
});
