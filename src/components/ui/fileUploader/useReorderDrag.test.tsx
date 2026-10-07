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

  it('Esc取消拖动及尚未提交的落位，不调用排序', () => {
    vi.useFakeTimers()
    const onReorder = vi.fn()
    const view = render(<Harness onReorder={onReorder} />)
    for (const dropping of [false, true]) {
      fireEvent.mouseDown(view.getByTestId('first'), { button: 0, clientX: 50, clientY: 50 })
      fireEvent.mouseMove(window, { clientX: 50, clientY: 90 })
      fireEvent.mouseMove(window, { clientX: 50, clientY: 170 })
      if (dropping) fireEvent.mouseUp(window)
      fireEvent.keyDown(window, { key: 'Escape' })
      fireEvent.mouseUp(window)
      act(() => vi.runAllTimers())
      expect(onReorder).not.toHaveBeenCalled()
      expect(view.getByTestId('drag-state').getAttribute('data-dragging')).toBe('false')
    }
  })
  it('浮窗中的排序和Esc监听目标所属窗口', () => {
    vi.useFakeTimers()
    const frame = document.createElement('iframe'); document.body.append(frame)
    const onReorder = vi.fn()
    const view = render(<Harness onReorder={onReorder} />, { container: frame.contentDocument!.body })
    const owner = frame.contentWindow!
    try {
      fireEvent.mouseDown(view.getByTestId('first'), { button: 0, clientX: 50, clientY: 50 })
      fireEvent.mouseMove(owner, { clientX: 50, clientY: 90 })
      fireEvent.mouseMove(owner, { clientX: 50, clientY: 170 })
      fireEvent.keyDown(owner, { key: 'Escape' }); fireEvent.mouseUp(owner)
      act(() => vi.runAllTimers()); expect(onReorder).not.toHaveBeenCalled()
      fireEvent.mouseDown(view.getByTestId('first'), { button: 0, clientX: 50, clientY: 50 })
      fireEvent.mouseMove(owner, { clientX: 50, clientY: 90 })
      fireEvent.mouseMove(owner, { clientX: 50, clientY: 170 }); fireEvent.mouseUp(owner)
      act(() => vi.runAllTimers()); expect(onReorder).toHaveBeenCalledWith(0, 1)
    } finally { view.unmount(); frame.remove() }
  })

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

  it('越过拖动阈值后直接在目标上松手，按松手位置落位', () => {
    vi.useFakeTimers();
    const onReorder = vi.fn();
    const rendered = render(<Harness onReorder={onReorder} />);

    fireEvent.mouseDown(rendered.getByTestId('first'), { button: 0, clientX: 50, clientY: 50 });
    fireEvent.mouseMove(window, { clientX: 50, clientY: 80 });
    fireEvent.mouseUp(window, { clientX: 50, clientY: 170 });
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
