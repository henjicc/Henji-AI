// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }) }));
vi.mock('./ImageInfoPanel', () => ({ ImageInfoPanel: () => null }));
vi.mock('@/services/imageSource', () => ({ resolveImageDisplayUrl: (url: string) => url }));
vi.mock('@/core/logging', () => ({ createLogger: () => ({ warn: vi.fn() }) }));
vi.mock('@/components/ui', async () => {
  const React = await import('react');
  return {
    UiSharedGlassHost: React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement> & { minTargets?: number }>(
      ({ minTargets: _minTargets, ...props }, ref) => <div {...props} ref={ref} />),
    UiButton: React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string; size?: string }>(
      ({ variant: _variant, size: _size, ...props }, ref) => <button {...props} ref={ref} />),
    UiIconButton: ({ appearance: _appearance, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { appearance?: string }) => <button {...props} />,
    UiOptionButton: ({ variant: _variant, active: _active, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string; active?: boolean }) => <button {...props} />,
    UiError: ({ message }: { message: string }) => <div role="alert">{message}</div>,
  };
});
import { ImageViewerModal } from './ImageViewerModal';

const props = { open: true, imageUrl: 'result.png', imageList: ['result.png'], currentIndex: 0, onClose: vi.fn(), onNavigate: vi.fn() };
function geometry(img: HTMLImageElement, left: number, naturalWidth: number) {
  const rect = { left, top: 0, width: 400, height: 400, right: left + 400, bottom: 400, x: left, y: 0, toJSON() {} };
  Object.defineProperties(img, { naturalWidth: { value: naturalWidth, configurable: true }, naturalHeight: { value: naturalWidth, configurable: true }, offsetWidth: { value: 400, configurable: true }, offsetHeight: { value: 400, configurable: true } });
  vi.spyOn(img, 'getBoundingClientRect').mockReturnValue(rect);
  vi.spyOn(img.parentElement!, 'getBoundingClientRect').mockReturnValue(rect);
  fireEvent.load(img);
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 16));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id));
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.clearAllMocks();
  Object.defineProperty(HTMLImageElement.prototype, 'decode', { configurable: true, writable: true, value: vi.fn(() => Promise.resolve()) });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('图片查看与同步对比', () => {
  it('普通图片不显示对比选项，关闭按钮与 Escape 均可退出', () => {
    render(<ImageViewerModal {...props} />);
    expect(screen.queryByRole('group', { name: '对比查看' })).toBeNull();
    const image = screen.getByAltText('图片') as HTMLImageElement;
    geometry(image, 0, 800);
    fireEvent.wheel(image, { clientX: 200, clientY: 200, deltaY: -250 });
    act(() => vi.advanceTimersByTime(1000));
    expect(image.style.transform).toContain('scale(1.414');
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(props.onClose).toHaveBeenCalledTimes(2);
  });
  it('两张不同分辨率的图在任意一侧缩放和平移时同步，重置会停止进行中的缩放', async () => {
    render(<ImageViewerModal {...props} comparisonImageUrl="original.png" />);
    fireEvent.click(screen.getByRole('button', { name: '左右对比' }));
    const original = screen.getByAltText('原图') as HTMLImageElement;
    await act(async () => { fireEvent.load(original); });
    const result = screen.getByAltText('放大后') as HTMLImageElement;
    geometry(original, 0, 400);
    geometry(result, 400, 1600);
    fireEvent.wheel(original, { clientX: 100, clientY: 200, deltaY: -250 });
    act(() => vi.advanceTimersByTime(1000));
    expect(result.style.transform).toBe(original.style.transform);
    expect(result.style.transform).toContain('scale(1.414');
    // 指针相对左侧视口中心 -100，而非整个对比区中心 -300。
    expect(result.style.transform).toContain('translate(29.289');
    fireEvent.mouseDown(result, { button: 0, clientX: 600, clientY: 200 });
    fireEvent.mouseMove(result, { clientX: 640, clientY: 240 });
    fireEvent.mouseUp(result);
    expect(result.style.transform).toBe(original.style.transform);
    fireEvent.wheel(result, { clientX: 600, clientY: 200, deltaY: -200 });
    fireEvent.click(screen.getByTitle('重置视图'));
    act(() => vi.advanceTimersByTime(1000));
    expect(result.style.transform).toBe('scale(1) translate(0px, 0px)');
    expect(original.style.transform).toBe(result.style.transform);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('分界线键盘调整不翻页，原图失效回退普通结果且换图后不残留错误', async () => {
    const view = render(<ImageViewerModal {...props} comparisonImageUrl="original.png" />);
    fireEvent.click(screen.getByRole('button', { name: '叠加对比' }));
    await act(async () => { fireEvent.load(screen.getByAltText('原图')); });
    const slider = screen.getByRole('slider');
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(slider.getAttribute('aria-valuenow')).toBe('52');
    expect(screen.getByAltText('原图').parentElement?.style.clipPath).toBe('inset(0 48% 0 0)');
    expect(screen.getByAltText('放大后').parentElement?.style.clipPath).toBe('inset(0 0 0 52%)');
    expect(props.onNavigate).not.toHaveBeenCalled();
    fireEvent.error(screen.getByAltText('原图'));
    expect(screen.queryByAltText('放大后')).toBeNull();
    expect(screen.getByAltText('图片').getAttribute('src')).toBe('result.png');
    expect(screen.getByRole('alert')).toBeTruthy();
    view.rerender(<ImageViewerModal {...props} imageUrl="other.png" comparisonImageUrl="other-original.png" />);
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '叠加对比' }));
    await act(async () => { fireEvent.load(screen.getByAltText('原图')); });
    expect(screen.getByRole('slider').getAttribute('aria-valuenow')).toBe('50');
  });
  it('原图解码完成前保持完整结果，切换模式复用已解码图片且不会被旧图片的解码结果覆盖', async () => {
    let completeDecode!: () => void;
    const view = render(<ImageViewerModal {...props} comparisonImageUrl="original.png" />);
    const result = screen.getByAltText('图片') as HTMLImageElement;
    geometry(result, 0, 800);
    fireEvent.wheel(result, { clientX: 200, clientY: 200, deltaY: -250 });
    act(() => vi.advanceTimersByTime(1000));
    const zoomedTransform = result.style.transform;
    const original = screen.getByAltText('原图') as HTMLImageElement;
    original.decode = vi.fn(() => new Promise<void>((resolve) => { completeDecode = resolve; }));
    fireEvent.load(original);
    fireEvent.click(screen.getByRole('button', { name: '叠加对比' }));
    expect(screen.queryByRole('slider')).toBeNull();
    expect(screen.getByAltText('图片')).toBe(result);
    await act(async () => completeDecode());
    expect(screen.getByAltText('放大后')).toBe(result);
    expect(result.style.transform).toBe(zoomedTransform);
    expect(screen.getByRole('slider')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '仅结果' }));
    fireEvent.click(screen.getByRole('button', { name: '叠加对比' }));
    expect(screen.getByAltText('原图')).toBe(original);
    expect(screen.getByAltText('放大后')).toBe(result);
    expect(original.decode).toHaveBeenCalledTimes(1);
    // 切换另一张图后，上一张尚未结束的解码不得切换当前视图。
    fireEvent.load(original);
    view.rerender(<ImageViewerModal {...props} imageUrl="other.png" comparisonImageUrl="other-original.png" />);
    fireEvent.click(screen.getByRole('button', { name: '叠加对比' }));
    await act(async () => completeDecode());
    expect(screen.queryByRole('slider')).toBeNull();
    await act(async () => { fireEvent.load(screen.getByAltText('原图')); });
    expect(screen.getByRole('slider')).toBeTruthy();
  });

  it('原图解码失败后保留结果并显示错误', async () => {
    render(<ImageViewerModal {...props} comparisonImageUrl="original.png" />);
    const original = screen.getByAltText('原图') as HTMLImageElement;
    original.decode = vi.fn(() => Promise.reject(new Error('decode failed')));
    fireEvent.click(screen.getByRole('button', { name: '叠加对比' }));
    await act(async () => { fireEvent.load(original); });
    expect(screen.queryByRole('slider')).toBeNull();
    expect(screen.getByAltText('图片').getAttribute('src')).toBe('result.png');
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('重复点击当前模式交换图片，保持图片实例、视图和分界线，两种模式独立记忆顺序', async () => {
    const view = render(<ImageViewerModal {...props} comparisonImageUrl="original.png" />);
    const original = screen.getByAltText('原图') as HTMLImageElement;
    const result = screen.getByAltText('图片') as HTMLImageElement;
    await act(async () => { fireEvent.load(original); });
    const side = screen.getByRole('button', { name: '左右对比' });
    fireEvent.click(side);
    geometry(original, 0, 400);
    geometry(result, 400, 1600);
    fireEvent.wheel(original, { clientX: 200, clientY: 200, deltaY: -250 });
    act(() => vi.advanceTimersByTime(1000));
    const zoomed = result.style.transform;
    fireEvent.click(side);
    expect(result.parentElement?.style.left).toBe('0px');
    expect(original.parentElement?.style.right).toBe('0px');
    expect(screen.getByAltText('放大后')).toBe(result);
    expect(result.style.transform).toBe(zoomed);
    expect(original.style.transform).toBe(zoomed);
    const overlay = screen.getByRole('button', { name: '叠加对比' });
    fireEvent.click(overlay);
    const slider = screen.getByRole('slider');
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(original.parentElement?.style.clipPath).toBe('inset(0 48% 0 0)');
    const beforeSwap = result.style.transform;
    fireEvent.click(overlay);
    expect(original.parentElement?.style.clipPath).toBe('inset(0 0 0 52%)');
    expect(result.parentElement?.style.clipPath).toBe('inset(0 48% 0 0)');
    expect(result.style.transform).toBe(beforeSwap);
    expect(slider.getAttribute('aria-valuenow')).toBe('52');
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(original.parentElement?.style.clipPath).toBe('inset(0 0 0 54%)');
    expect(result.parentElement?.style.clipPath).toBe('inset(0 46% 0 0)');
    fireEvent.click(overlay);
    expect(original.parentElement?.style.clipPath).toBe('inset(0 46% 0 0)');
    fireEvent.click(side);
    expect(original.parentElement?.style.right).toBe('0px');
    fireEvent.click(side);
    expect(original.parentElement?.style.left).toBe('0px');
    fireEvent.click(side);
    view.rerender(<ImageViewerModal {...props} open={false} comparisonImageUrl="original.png" />);
    view.rerender(<ImageViewerModal {...props} comparisonImageUrl="original.png" />);
    fireEvent.click(side);
    expect(original.parentElement?.style.left).toBe('0px');
  });

});
