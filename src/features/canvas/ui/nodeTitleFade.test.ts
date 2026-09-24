/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NODE_TITLE_MASK_PROPERTY, observeNodeTitleFade } from './nodeTitleFade';

let resizeCallback: ResizeObserverCallback;
const resize = { observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() };
const dispose: Array<() => void> = [];
const textBounds = new Map<Node, DOMRect>();
const fonts = new EventTarget();

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', vi.fn((callback: ResizeObserverCallback) => {
    resizeCallback = callback;
    return resize;
  }));
  Object.defineProperty(document, 'fonts', { configurable: true, value: fonts });
  vi.spyOn(document, 'createRange').mockImplementation(() => {
    let selected: Node;
    const range = new Range();
    range.selectNodeContents = node => { selected = node; };
    range.getBoundingClientRect = () => textBounds.get(selected)!;
    return range;
  });
});

afterEach(() => {
  dispose.splice(0).forEach(stop => stop());
  document.body.replaceChildren();
  document.documentElement.removeAttribute('style');
  textBounds.clear();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

function title(width = 100) {
  const element = document.createElement('span');
  element.textContent = '测试标题';
  document.body.append(element);
  let box = new DOMRect(10, 10, width, 20);
  const measure = vi.spyOn(element, 'getBoundingClientRect').mockImplementation(() => box);
  textBounds.set(element, new DOMRect(10, 10, 40, 14));
  const stop = observeNodeTitleFade(element)!;
  dispose.push(stop);
  return { element, measure, setBox: (next: DOMRect) => { box = next; } };
}

function resized(...elements: HTMLElement[]) {
  resizeCallback(elements.map(target => ({
    target, contentRect: new DOMRect(), borderBoxSize: [], contentBoxSize: [], devicePixelContentBoxSize: [],
  })), resize);
}

it('仅移除有字形余量的短标题遮罩，缩窄、隐藏与重新显现时重新判断', () => {
  const t = title();
  resized(t.element);
  expect(t.element.style.getPropertyValue(NODE_TITLE_MASK_PROPERTY)).toBe('none');
  t.setBox(new DOMRect(10, 10, 60, 20));
  resized(t.element);
  expect(t.element.style.getPropertyValue(NODE_TITLE_MASK_PROPERTY)).toBe('');
  t.setBox(new DOMRect());
  resized(t.element);
  expect(t.element.style.getPropertyValue(NODE_TITLE_MASK_PROPERTY)).toBe('');
  t.setBox(new DOMRect(10, 10, 100, 20));
  resized(t.element);
  expect(t.element.style.getPropertyValue(NODE_TITLE_MASK_PROPERTY)).toBe('none');
  t.setBox(new DOMRect());
  resized(t.element);
  expect(t.element.style.getPropertyValue(NODE_TITLE_MASK_PROPERTY)).toBe('none');
});

it('字体加载或主题改变后的长标题恢复渐隐，多个标题共享观察器且先读后写', async () => {
  const a = title();
  const b = title();
  expect(ResizeObserver).toHaveBeenCalledTimes(1);
  const write = vi.spyOn(a.element.style, 'setProperty');
  resized(a.element, b.element);
  expect(b.measure.mock.invocationCallOrder[0]).toBeLessThan(write.mock.invocationCallOrder[0]);
  textBounds.set(a.element, new DOMRect(10, 10, 90, 14));
  fonts.dispatchEvent(new Event('loadingdone'));
  expect(a.element.style.getPropertyValue(NODE_TITLE_MASK_PROPERTY)).toBe('');
  expect(b.element.style.getPropertyValue(NODE_TITLE_MASK_PROPERTY)).toBe('none');
  textBounds.set(b.element, new DOMRect(10, 10, 90, 14));
  document.documentElement.style.fontSize = '20px';
  await Promise.resolve();
  expect(b.element.style.getPropertyValue(NODE_TITLE_MASK_PROPERTY)).toBe('');
});

it('卸载不再测量，最后一个标题释放观察器和字体监听，后续挂载可重建', () => {
  const a = title();
  const b = title();
  resized(a.element, b.element);
  dispose.shift()!();
  a.measure.mockClear();
  fonts.dispatchEvent(new Event('loadingdone'));
  expect(a.measure).not.toHaveBeenCalled();
  expect(a.element.style.getPropertyValue(NODE_TITLE_MASK_PROPERTY)).toBe('');
  expect(resize.disconnect).not.toHaveBeenCalled();
  dispose.shift()!();
  expect(resize.disconnect).toHaveBeenCalledTimes(1);
  b.measure.mockClear();
  resized(a.element, b.element);
  fonts.dispatchEvent(new Event('loadingdone'));
  expect(b.measure).not.toHaveBeenCalled();
  const c = title();
  expect(ResizeObserver).toHaveBeenCalledTimes(2);
  resized(c.element);
  expect(c.element.style.getPropertyValue(NODE_TITLE_MASK_PROPERTY)).toBe('none');
});
