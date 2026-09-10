/** @vitest-environment jsdom */
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EdgeFlowPulse } from './EdgeFlowPulse';
import { readEdgeFlowDiagnostics } from './edgeFlowAnimation';

vi.mock('@xyflow/react', () => ({ EdgeLabelRenderer: ({ children }: { children: React.ReactNode }) => children }));
const frames = new Map<number, FrameRequestCallback>();
let frameId = 0;
let motion: EventTarget & { matches: boolean };
const context = {
  resetTransform: vi.fn(), clearRect: vi.fn(), setTransform: vi.fn(), setLineDash: vi.fn(), stroke: vi.fn(),
  strokeStyle: '', lineWidth: 0, lineCap: '', lineDashOffset: 0,
};
const pathCreated = vi.fn();
const disconnect = vi.fn();

beforeEach(() => {
  frames.clear();
  motion = Object.assign(new EventTarget(), { matches: false });
  vi.stubGlobal('matchMedia', () => motion);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.stubGlobal('Path2D', class { constructor(path: string) { pathCreated(path); } });
  vi.stubGlobal('DOMMatrix', class {
    a = 1; e = 0; f = 0;
    constructor(value = '') {
      const parts = value.match(/translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([-\d.]+)\)/);
      if (parts) { this.e = +parts[1]; this.f = +parts[2]; this.a = +parts[3]; }
    }
  });
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect = disconnect; });
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
  Object.defineProperties(SVGElement.prototype, {
    getTotalLength: { configurable: true, value: () => 320 },
    getPointAtLength: { configurable: true, value: function (this: SVGElement, d: number) {
      return { x: (this.getAttribute('d')?.includes('9000') ? 9000 : 0) + d, y: 100 };
    } },
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
function tick(time: number) {
  const callbacks = [...frames.values()]; frames.clear();
  act(() => callbacks.forEach((callback) => callback(time)));
}
function Scene({ path = 'M0,100L320,100', second = true }: { path?: string; second?: boolean }) {
  return <div className="react-flow"><div className="react-flow__pane">
    <div className="react-flow__viewport" style={{ transform: 'translate(0px, 0px) scale(1)' }} />
    <EdgeFlowPulse path={path} edgeId="a" />
    {second && <EdgeFlowPulse path="M0,100L320,100" edgeId="b" />}
  </div></div>;
}

describe('共享流动虚线层', () => {
  it('多条连线只创建一个 Canvas 和一个帧循环，使用缓存路径绘制虚线', () => {
    const view = render(<Scene />);
    expect(view.container.querySelectorAll('canvas')).toHaveLength(1);
    expect(frames.size).toBe(1);
    tick(100);
    expect(context.setLineDash).toHaveBeenLastCalledWith([12, 20]);
    expect(context.stroke).toHaveBeenCalledTimes(2);
    expect(pathCreated).toHaveBeenCalledTimes(2);
    const phase = context.lineDashOffset;
    tick(140);
    expect(context.lineDashOffset).not.toBe(phase);
    expect(pathCreated).toHaveBeenCalledTimes(2);
    expect(frames.size).toBe(1);
  });

  it('全部离屏时停帧，视口变化后恢复并同步坐标；减少动效和后台时停止循环', async () => {
    const view = render(<Scene path="M9000,100L9320,100" second={false} />);
    tick(100);
    expect(context.stroke).not.toHaveBeenCalled();
    expect(frames.size).toBe(0);
    await act(async () => {
      view.container.querySelector<HTMLElement>('.react-flow__viewport')!.style.transform = 'translate(-9000px, 0px) scale(1)';
    });
    expect(context.stroke).toHaveBeenCalledTimes(1);
    const flow = view.container.querySelector<HTMLElement>('.react-flow')!;
    expect(readEdgeFlowDiagnostics(flow)).toMatchObject({ visibleCount: 1, matrix: { x: -9000 } });
    expect(frames.size).toBe(1);
    act(() => { motion.matches = true; motion.dispatchEvent(new Event('change')); });
    expect(frames.size).toBe(0);
    act(() => { motion.matches = false; motion.dispatchEvent(new Event('change')); });
    expect(frames.size).toBe(1);
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(frames.size).toBe(0);
  });

  it('同路径重渲染不重建，端点变化更新缓存，最后一条结束释放帧和画布', () => {
    const view = render(<Scene />);
    view.rerender(<Scene />);
    expect(pathCreated).toHaveBeenCalledTimes(2);
    view.rerender(<Scene path="M0,100L500,100" />);
    expect(pathCreated).toHaveBeenCalledTimes(3);
    expect(view.container.querySelectorAll('canvas')).toHaveLength(1);
    view.rerender(<Scene path="M0,100L500,100" second={false} />);
    expect(view.container.querySelectorAll('canvas')).toHaveLength(1);
    view.unmount();
    expect(frames.size).toBe(0);
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});
