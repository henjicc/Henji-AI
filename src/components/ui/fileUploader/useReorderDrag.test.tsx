/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useReorderDrag } from './useReorderDrag';

function rect(left: number, top: number, width = 100, height = 100): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    toJSON: () => ({}),
  } as DOMRect;
}

function Harness({
  onReorder,
  allowButtonTarget = false,
  layout = 'grid',
}: {
  onReorder: (from: number, to: number) => void
  allowButtonTarget?: boolean
  layout?: 'grid' | 'vertical'
}) {
  const boundaryRef = useRef<HTMLDivElement>(null);
  const { dragState, itemRefs, handleMouseDown } = useReorderDrag({
    disabled: false,
    isCustomDragging: false,
    files: ['first', 'second'],
    layout,
    dragBoundaryRef: layout === 'vertical' ? boundaryRef : undefined,
    allowButtonTarget,
    onReorder,
  });
  return (
    <div ref={boundaryRef} data-testid="boundary">
      <output
        data-testid="drag-state"
        data-current-x={dragState.currentX}
        data-current-y={dragState.currentY}
        data-dragging={dragState.isDragging}
      />
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

  it('纵向列表只按垂直中心判定插入位置', () => {
    vi.useFakeTimers();
    const onReorder = vi.fn();
    const rendered = render(<Harness onReorder={onReorder} layout="vertical" />);

    fireEvent.mouseDown(rendered.getByTestId('first'), { button: 0, clientX: 50, clientY: 50 });
    fireEvent.mouseMove(window, { clientX: 350, clientY: 80 });
    fireEvent.mouseMove(window, { clientX: 350, clientY: 170 });
    fireEvent.mouseUp(window);
    act(() => vi.advanceTimersByTime(150));

    expect(onReorder).toHaveBeenCalledWith(0, 1);
  });

  it('纵向列表锁定横轴并把拖拽项完整限制在可视边界内', () => {
    const onReorder = vi.fn();
    const rendered = render(<Harness onReorder={onReorder} layout="vertical" />);
    rendered.getByTestId('boundary').getBoundingClientRect = () => rect(0, 0, 100, 220);

    fireEvent.mouseDown(rendered.getByTestId('first'), { button: 0, clientX: 50, clientY: 50 });
    fireEvent.mouseMove(window, { clientX: 350, clientY: 80 });
    fireEvent.mouseMove(window, { clientX: 500, clientY: 400 });

    const state = rendered.getByTestId('drag-state');
    expect(state.getAttribute('data-dragging')).toBe('true');
    expect(state.getAttribute('data-current-x')).toBe('50');
    expect(state.getAttribute('data-current-y')).toBe('170');

    fireEvent.mouseMove(window, { clientX: -500, clientY: -400 });
    expect(state.getAttribute('data-current-x')).toBe('50');
    expect(state.getAttribute('data-current-y')).toBe('50');
  });
});
