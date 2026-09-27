/** @vitest-environment jsdom */
import React from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { CanvasVideoPlayer } from './CanvasVideoPlayer';

vi.mock('@/commands/video', () => ({ readVideoInfo: vi.fn() }));
vi.mock('@/components/ui', () => ({
  UiIconButton: ({ showBorder: _border, appearance: _appearance, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { showBorder?: boolean; appearance?: string }) => React.createElement('button', props),
  UiRangeInput: (props: React.InputHTMLAttributes<HTMLInputElement>) => React.createElement('input', props),
}));
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('暂停布局的零宽度不切换视频控件，恢复后仍响应真实宽度', () => {
  let resize: (entries: Array<{ contentRect: { width: number } }>) => void = () => {};
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: typeof resize) { resize = callback; }
    observe() {} disconnect() {}
  });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 300 } as DOMRect);
  const view = render(<CanvasVideoPlayer src="media:video" knownHasAudio knownDuration={120} onOpenViewer={() => {}} />);
  expect(view.queryByRole('button', { name: '静音' })).not.toBeNull();
  act(() => resize([{ contentRect: { width: 0 } }]));
  expect(view.queryByRole('button', { name: '静音' })).not.toBeNull();
  act(() => resize([{ contentRect: { width: 180 } }]));
  expect(view.queryByRole('button', { name: '静音' })).toBeNull();
  act(() => resize([{ contentRect: { width: 300 } }]));
  expect(view.queryByRole('button', { name: '静音' })).not.toBeNull();
});
