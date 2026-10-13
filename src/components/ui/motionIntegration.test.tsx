/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@/i18n/config';
import Dropdown from './Dropdown';
import PanelTrigger from './PanelTrigger';
import AlertDialog from './AlertDialog';
import Tooltip from './Tooltip';
import { UiButton } from './primitives';
import { AudioViewerModal } from '../mediaViewer/AudioViewerModal';
import { NotificationProvider, useNotification } from '@/contexts/NotificationContext';
import { useToast } from '@/workspaces/GenerationWorkspace/hooks/useToast';
import { UI_DURATION, UI_TOAST_DISPLAY_MS } from './motion';

vi.mock('@/components/AudioPlayer', () => ({ default: () => <div>音频内容</div> }));

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
function reducedMotion(): void {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
}

describe('正式调用方共用进出场', () => {
  it.each(['dropdown', 'panel'] as const)('%s 减少动效关闭立即卸载，不遗留收起面板', kind => {
    reducedMotion();
    const view = render(kind === 'dropdown'
      ? <Dropdown ariaLabel="触发" value="a" options={[{ value: 'a', label: '选项' }]} onSelect={() => undefined} />
      : <PanelTrigger display="触发" renderPanel={() => <div>面板内容</div>} />);
    fireEvent.click(view.getByRole('button', { name: /触发/ }));
    expect(document.querySelector(kind === 'dropdown' ? '[data-dropdown-portal]' : '[data-panel-placement]')).not.toBeNull();
    fireEvent.click(view.getByRole('button', { name: /触发/ }));
    expect(document.querySelector(kind === 'dropdown' ? '[data-dropdown-portal]' : '[data-panel-placement]')).toBeNull();
  });
  it('提示退出中立即回到锚点会取消旧退出，减少动效直接隐藏', () => {
    reducedMotion();
    const view = render(<Tooltip content="说明"><span>锚点</span></Tooltip>);
    const anchor = view.getByText('锚点').parentElement!;
    fireEvent.focus(anchor);
    expect(view.getByRole('tooltip')).toBeTruthy();
    fireEvent.blur(anchor);
    expect(view.queryByRole('tooltip')).toBeNull();
    fireEvent.focus(anchor);
    act(() => vi.advanceTimersByTime(UI_DURATION.slow));
    expect(view.getByRole('tooltip')).toBeTruthy();
  });
  it('音频查看器双帧进入，结束事件退出，退出中重开保留新画面', () => {
    const view = render(<AudioViewerModal open audioUrl="" onClose={() => undefined} />);
    const root = view.getByText('音频内容').closest('.z-viewer') as HTMLElement;
    expect(root.style.opacity).toBe('0');
    act(() => vi.advanceTimersByTime(32));
    expect(root.style.opacity).toBe('1');
    view.rerender(<AudioViewerModal open={false} audioUrl="" onClose={() => undefined} />);
    view.rerender(<AudioViewerModal open audioUrl="" onClose={() => undefined} />);
    act(() => vi.advanceTimersByTime(UI_DURATION.viewer));
    expect(view.getByText('音频内容')).toBeTruthy();
    view.rerender(<AudioViewerModal open={false} audioUrl="" onClose={() => undefined} />);
    fireEvent.transitionEnd(root);
    expect(view.queryByText('音频内容')).toBeNull();
  });
  it('确认弹窗减少动效关闭只通知一次，无退出等待', () => {
    reducedMotion();
    const close = vi.fn();
    const view = render(<AlertDialog isOpen title="确认" message="内容" closeLabel="关闭" onClose={close} />);
    fireEvent.click(view.getByRole('button', { name: '关闭' }));
    expect(close).toHaveBeenCalledTimes(1);
    expect(view.queryByRole('alertdialog', { hidden: true })).toBeNull();
    act(() => vi.advanceTimersByTime(UI_DURATION.base));
    expect(close).toHaveBeenCalledTimes(1);
  });
  it('全局与生成页通知同拍进入、同档退出，替换取消旧卸载', () => {
    function Probe(): JSX.Element {
      const { showNotification, notificationVisible } = useNotification();
      return <UiButton aria-pressed={notificationVisible} onClick={() => showNotification('通知')}>显示通知</UiButton>;
    }
    const view = render(<NotificationProvider><Probe /></NotificationProvider>);
    const { result } = renderHook(() => useToast());
    act(() => { fireEvent.click(view.getByRole('button', { name: '显示通知' })); result.current.show('通知'); });
    expect(view.getByRole('button').getAttribute('aria-pressed')).toBe(String(result.current.visible));
    expect(result.current.visible).toBe(false);
    act(() => vi.advanceTimersByTime(32));
    expect(result.current.visible).toBe(true);
    expect(view.getByRole('button').getAttribute('aria-pressed')).toBe('true');
    act(() => vi.advanceTimersByTime(UI_TOAST_DISPLAY_MS));
    expect(result.current.visible).toBe(false);
    act(() => { fireEvent.click(view.getByRole('button')); result.current.show('替换'); });
    act(() => vi.advanceTimersByTime(UI_DURATION.slow));
    expect(view.getByRole('status')).toBeTruthy();
    expect(result.current.notification?.message).toBe('替换');
  });
});
