/** @vitest-environment jsdom */
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EdgeFlowPulse } from './EdgeFlowPulse';
import { sampleEdgeFlow } from './edgeFlowAnimation';

vi.mock('@xyflow/react', () => ({ EdgeLabelRenderer: ({ children }: { children: React.ReactNode }) => children }));
const animations: Array<ReturnType<typeof makeAnimation>> = [];
function makeAnimation() {
  return {
    playState: 'running', currentTime: 0,
    play: vi.fn(function (this: { playState: string }) { this.playState = 'running'; }),
    pause: vi.fn(function (this: { playState: string }) { this.playState = 'paused'; }),
    cancel: vi.fn(),
  };
}
let intersection: IntersectionObserverCallback;
const observed = new Set<Element>();
const disconnect = vi.fn();
let motion: EventTarget & { matches: boolean };

beforeEach(() => {
  animations.length = 0;
  observed.clear();
  motion = Object.assign(new EventTarget(), { matches: false });
  vi.stubGlobal('matchMedia', () => motion);
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: IntersectionObserverCallback) { intersection = callback; }
    observe(element: Element) { observed.add(element); }
    unobserve(element: Element) { observed.delete(element); }
    disconnect = disconnect;
  });
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  Object.defineProperties(SVGElement.prototype, {
    getTotalLength: { configurable: true, value: () => 320 },
    getPointAtLength: { configurable: true, value: (distance: number) => ({ x: distance, y: 100 }) },
  });
  Object.defineProperty(Element.prototype, 'animate', { configurable: true, value: vi.fn(() => {
    const animation = makeAnimation(); animations.push(animation); return animation;
  }) });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks(); vi.unstubAllGlobals(); disconnect.mockClear();
});
function visibility(element: Element, visible: boolean) {
  intersection([{ target: element, isIntersecting: visible } as IntersectionObserverEntry], {} as IntersectionObserver);
}

describe('连线流动动画', () => {
  it('采样保留负坐标、首尾和等路程时间；极长路径仍有有界关键帧', () => {
    const sample = sampleEdgeFlow({
      getTotalLength: () => 320,
      getPointAtLength: (distance) => ({ x: distance - 500, y: 100 } as DOMPoint),
    });
    expect(sample).toMatchObject({ left: -504, top: 96, width: 328, height: 8, duration: 2000 });
    expect(sample?.keyframes[0]).toMatchObject({ offset: 0, transform: 'translate(0px, 0px)' });
    expect(sample?.keyframes.at(-1)).toMatchObject({ offset: 1, transform: 'translate(320px, 0px)' });
    expect(sampleEdgeFlow({ getTotalLength: () => 0, getPointAtLength: vi.fn() })).toBeNull();
    expect(sampleEdgeFlow({ getTotalLength: () => 100000, getPointAtLength: (d) => ({ x: d, y: 0 } as DOMPoint) })?.keyframes.length).toBeLessThanOrEqual(97);
  });

  it('可见时播放，离屏/隐藏/减少动效时暂停；结束清理全部观察和动画', () => {
    const view = render(<><EdgeFlowPulse path="M0,0L320,0" edgeId="a" /><EdgeFlowPulse path="M0,1L320,1" edgeId="b" /></>);
    const [a, b] = Array.from(observed);
    expect(animations.every((item) => item.playState === 'paused')).toBe(true);
    act(() => { visibility(a, true); visibility(b, true); });
    expect(animations.every((item) => item.playState === 'running')).toBe(true);
    act(() => visibility(a, false));
    expect(animations[0].playState).toBe('paused');
    expect(animations[1].playState).toBe('running');
    act(() => { motion.matches = true; motion.dispatchEvent(new Event('change')); });
    expect(animations[1].playState).toBe('paused');
    act(() => { motion.matches = false; motion.dispatchEvent(new Event('change')); });
    expect(animations[1].playState).toBe('running');
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(animations[1].playState).toBe('paused');
    view.unmount();
    expect(observed.size).toBe(0);
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(animations.every((item) => item.cancel.mock.calls.length === 1)).toBe(true);
  });

  it('同路径重渲染不重建动画，端点变化保留相位且释放旧动画', () => {
    const view = render(<EdgeFlowPulse path="M0,0L320,0" edgeId="a" />);
    animations[0].currentTime = 750;
    view.rerender(<EdgeFlowPulse path="M0,0L320,0" edgeId="a" />);
    expect(animations).toHaveLength(1);
    view.rerender(<EdgeFlowPulse path="M0,0L0,320" edgeId="a" />);
    expect(animations).toHaveLength(2);
    expect(animations[0].cancel).toHaveBeenCalledTimes(1);
    expect(animations[1].currentTime).toBe(750);
    expect(view.container.querySelectorAll('.canvas-edge-flow-pulse')).toHaveLength(1);
  });
});
