/** @vitest-environment jsdom */

import { cleanup, fireEvent, render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { NODE_HEADER_FLOATING_POSITION_CLASS, NodeHeader } from './NodeHeader';

vi.mock('@xyflow/react', () => ({
  useNodeId: () => 'node-1',
  useInternalNode: () => ({
    measured: { width: 420, height: 240 },
    internals: {
      positionAbsolute: { x: 120, y: 80 },
      z: 3,
      userNode: {},
    },
  }),
  ViewportPortal: ({ children }: { children: ReactNode }) => children,
}));

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
});

function renderHeader(editable = false) {
  const nodeElement = document.createElement('div');
  nodeElement.className = 'react-flow__node nopan';
  nodeElement.dataset.id = 'node-1';
  document.body.appendChild(nodeElement);

  const rendered = render(
    <NodeHeader
      className={NODE_HEADER_FLOATING_POSITION_CLASS}
      titleText="AI 图片"
      rightSlot={<span>¥0.41</span>}
      editable={editable}
      onTitleChange={vi.fn()}
    />,
  );

  return { nodeElement, rendered };
}

describe('NodeHeader', () => {
  it('浮动标题按下时把事件交给真实节点，并阻止画布平移命中', () => {
    const { nodeElement, rendered } = renderHeader();
    const nodeMouseDown = vi.fn();
    nodeElement.addEventListener('mousedown', nodeMouseDown);

    const dragSurface = rendered.container.querySelector<HTMLElement>('[data-node-header-drag-surface="node-1"]');
    expect(dragSurface).not.toBeNull();
    expect(dragSurface?.classList.contains('nopan')).toBe(true);

    fireEvent.mouseDown(dragSurface!, {
      button: 0,
      buttons: 1,
      clientX: 180,
      clientY: 64,
    });

    expect(nodeMouseDown).toHaveBeenCalledTimes(1);
    const forwardedEvent = nodeMouseDown.mock.calls[0]?.[0] as MouseEvent;
    expect(forwardedEvent.clientX).toBe(180);
    expect(forwardedEvent.clientY).toBe(64);
  });

  it('双击浮动标题进入编辑态时，仅临时解除当前节点的绘制隔离', () => {
    const { nodeElement, rendered } = renderHeader(true);
    const dragSurface = rendered.container.querySelector<HTMLElement>('[data-node-header-drag-surface="node-1"]');

    fireEvent.doubleClick(dragSurface!);

    expect(rendered.getByRole('textbox')).toBeTruthy();
    expect(nodeElement.classList.contains('canvas-node-header-editing')).toBe(true);

    fireEvent.keyDown(rendered.getByRole('textbox'), { key: 'Escape' });
    expect(nodeElement.classList.contains('canvas-node-header-editing')).toBe(false);
  });
});
