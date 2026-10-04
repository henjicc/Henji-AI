/** @vitest-environment jsdom */
import React from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
// 组件文案走 i18n：加载正式语言资源，断言按中英两种文案匹配
import '@/i18n/config'
import { CanvasVideoPlayer } from './CanvasVideoPlayer';

vi.mock('@/commands/video', () => ({ readVideoInfo: vi.fn() }));
vi.mock('@/components/ui', () => ({
  UiIconButton: ({ size: _size, tone: _tone, on: _on, shape: _shape, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { size?: string; tone?: string; on?: boolean; shape?: string }) => React.createElement('button', props),
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
  expect(view.queryByRole('button', { name: /^(静音|Mute)$/ })).not.toBeNull();
  act(() => resize([{ contentRect: { width: 0 } }]));
  expect(view.queryByRole('button', { name: /^(静音|Mute)$/ })).not.toBeNull();
  act(() => resize([{ contentRect: { width: 180 } }]));
  expect(view.queryByRole('button', { name: /^(静音|Mute)$/ })).toBeNull();
  act(() => resize([{ contentRect: { width: 300 } }]));
  expect(view.queryByRole('button', { name: /^(静音|Mute)$/ })).not.toBeNull();
});
