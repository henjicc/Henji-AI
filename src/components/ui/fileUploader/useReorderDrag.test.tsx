/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useReorderDrag } from './useReorderDrag';

function rect(left: number, top: number): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    right: left + 100,
    bottom: top + 100,
    width: 100,
    height: 100,
    toJSON: () => ({}),
  } as DOMRect;
}

function Harness({
  onReorder,
  allowButtonTarget = false,
}: {
  onReorder: (from: number, to: number) => void
  allowButtonTarget?: boolean
}) {
  const { itemRefs, handleMouseDown } = useReorderDrag({
    disabled: false,
    isCustomDragging: false,
    files: ['first', 'second'],
    layout: 'grid',
    allowButtonTarget,
    onReorder,
  });
  return (
    <div>
      {['first', 'second'].map((id, index) => (
        <div
          key={id}
          data-testid={id}
          ref={(element) => {
            itemRefs.current[index] = element;
            if (element) element.getBoundingClientRect = () => rect(0, index * 120);
          }}
          onMouseDown={(event) => handleMouseDown(index, event)}
        >
          <button type="button">{id}</button>
        </div>
      ))}
    </div>
  );
}

describe('useReorderDrag grid layout', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('跨行拖到目标卡片后提交新的同类顺序', () => {
    vi.useFakeTimers();
    const onReorder = vi.fn();
    const rendered = render(<Harness onReorder={onReorder} />);

    fireEvent.mouseDown(rendered.getByTestId('first'), { button: 0, clientX: 50, clientY: 50 });
    fireEvent.mouseMove(window, { clientX: 50, clientY: 80 });
    fireEvent.mouseMove(window, { clientX: 50, clientY: 170 });
    fireEvent.mouseUp(window);
    act(() => vi.advanceTimersByTime(150));

    expect(onReorder).toHaveBeenCalledWith(0, 1);
  });

  it('调用方显式允许时可从按钮内容开始拖拽', () => {
    vi.useFakeTimers();
    const onReorder = vi.fn();
    const rendered = render(<Harness onReorder={onReorder} allowButtonTarget />);

    fireEvent.mouseDown(rendered.getByRole('button', { name: 'first' }), {
      button: 0,
      clientX: 50,
      clientY: 50,
    });
    fireEvent.mouseMove(window, { clientX: 50, clientY: 80 });
    fireEvent.mouseMove(window, { clientX: 50, clientY: 170 });
    fireEvent.mouseUp(window);
    act(() => vi.advanceTimersByTime(150));

    expect(onReorder).toHaveBeenCalledWith(0, 1);
  });
});
