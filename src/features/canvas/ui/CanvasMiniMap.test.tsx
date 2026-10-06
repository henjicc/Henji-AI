/** @vitest-environment jsdom */

import { act, cleanup, render } from '@testing-library/react';
import { ReactFlowProvider, useStoreApi } from '@xyflow/react';
import { afterEach, expect, it, vi } from 'vitest';
import { CanvasMiniMap } from './CanvasMiniMap';

const setViewport = vi.hoisted(() => vi.fn());

// 只替换视口写入；保留正式 ReactFlow store 与小地图渲染。
vi.mock('@xyflow/react', async (importOriginal) => ({
  ...await importOriginal<typeof import('@xyflow/react')>(),
  useReactFlow: () => ({ setViewport }),
}));

afterEach(() => { cleanup(); setViewport.mockReset(); });

it('滚轮缩放走非被动原生监听：能拦住默认滚动，按当前视口中心缩放，卸载后解绑', () => {
  let store!: ReturnType<typeof useStoreApi>;
  function Probe() {
    store = useStoreApi();
    return <CanvasMiniMap />;
  }
  const view = render(<ReactFlowProvider><Probe /></ReactFlowProvider>);
  act(() => store.setState({ width: 400, height: 300, transform: [0, 0, 1], minZoom: 0.1, maxZoom: 4 }));
  const svg = view.container.querySelector('svg.react-flow__minimap-svg');
  expect(svg).not.toBeNull();

  const wheel = new WheelEvent('wheel', { deltaY: -100, cancelable: true, bubbles: true });
  svg!.dispatchEvent(wheel);
  expect(wheel.defaultPrevented).toBe(true);
  expect(setViewport).toHaveBeenCalledTimes(1);
  const next = setViewport.mock.calls[0][0] as { x: number; y: number; zoom: number };
  expect(next.zoom).toBeGreaterThan(1);
  // 视口中心（200,150）缩放前后对应同一画布点
  expect((200 - next.x) / next.zoom).toBeCloseTo(200);
  expect((150 - next.y) / next.zoom).toBeCloseTo(150);

  view.unmount();
  svg!.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, cancelable: true }));
  expect(setViewport).toHaveBeenCalledTimes(1);
});
