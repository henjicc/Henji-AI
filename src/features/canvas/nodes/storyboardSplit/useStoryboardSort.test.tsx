/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useStoryboardSort } from './useStoryboardSort';
const frames = ['a', 'b'].map((id, order) => ({ id, order, note: '', imageUrl: null }));
function Harness({ reorder }: { reorder: (nodeId: string, from: string, to: string) => void }): JSX.Element {
  const { itemRefs, handleSortStart, draggedFrameId } = useStoryboardSort({ nodeId: 'storyboard', frames, reorderStoryboardFrame: reorder });
  return <div data-testid="state" data-dragging={draggedFrameId ?? ''}>
    {frames.map((frame, index) => <div key={frame.id} data-testid={frame.id}
      ref={(element) => {
        itemRefs.current[index] = element;
        if (element) element.getBoundingClientRect = () => ({ left: index * 120, top: 0, width: 100, height: 100 } as DOMRect);
      }} onPointerDown={(event) => handleSortStart(index, event)} />)}
  </div>;
}
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
it('公共网格排序只在释放指针后提交，pointercancel 清理拖动和待提交落位', () => {
  vi.stubGlobal('PointerEvent', MouseEvent);
  vi.useFakeTimers();
  const reorder = vi.fn();
  const view = render(<Harness reorder={reorder} />);
  for (const phase of ['dragging', 'dropping', 'commit']) {
    fireEvent.pointerDown(view.getByTestId('a'), { button: 0, clientX: 50, clientY: 50 });
    fireEvent.pointerMove(window, { clientX: 90, clientY: 50 });
    fireEvent.pointerMove(window, { clientX: 170, clientY: 50 });
    if (phase !== 'dragging') fireEvent.pointerUp(window, { clientX: 170, clientY: 50 });
    if (phase !== 'commit') fireEvent.pointerCancel(window);
    act(() => { vi.runAllTimers(); });
    expect(reorder).toHaveBeenCalledTimes(phase === 'commit' ? 1 : 0);
    expect(view.getByTestId('state').getAttribute('data-dragging')).toBe('');
  }
  expect(reorder).toHaveBeenCalledWith('storyboard', 'a', 'b');
});
