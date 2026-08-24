/** @vitest-environment jsdom */

import { cleanup, fireEvent, render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useCanvasExecutionStateStore } from '@/stores/canvasExecutionStateStore';
import { NODE_HEADER_FLOATING_POSITION_CLASS, NodeHeader } from './NodeHeader';

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string) => ({
        'node.execution.processing': '处理中',
        'node.execution.generating': '生成中',
      })[key] ?? key,
    }),
  };
});

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
  useCanvasExecutionStateStore.getState().resetNodeExecutions();
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
    expect(dragSurface?.style.width).toBe('calc(100% - 2.5rem)');

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

  it('双击浮动标题时不将前置 click 冒泡为节点选中', () => {
    const onNodeSelect = vi.fn();
    const nodeElement = document.createElement('div');
    nodeElement.className = 'react-flow__node nopan';
    nodeElement.dataset.id = 'node-1';
    document.body.appendChild(nodeElement);

    const rendered = render(
      <div onClick={onNodeSelect}>
        <NodeHeader
          className={NODE_HEADER_FLOATING_POSITION_CLASS}
          titleText="AI 图片"
          editable
          onTitleChange={vi.fn()}
        />
      </div>,
    );
    const dragSurface = rendered.container.querySelector<HTMLElement>('[data-node-header-drag-surface="node-1"]');

    fireEvent.click(dragSurface!);
    fireEvent.click(dragSurface!);
    fireEvent.doubleClick(dragSurface!);

    expect(onNodeSelect).not.toHaveBeenCalled();
    expect(rendered.getByRole('textbox')).toBeTruthy();
  });

  it('在标题旁显示当前节点的执行阶段', () => {
    useCanvasExecutionStateStore.getState().beginNodeExecution('node-1', {
      runId: 'run-1',
      phase: 'processing',
    });

    const { rendered } = renderHeader();

    expect(rendered.getByRole('status').textContent).toContain('处理中');
  });
});
