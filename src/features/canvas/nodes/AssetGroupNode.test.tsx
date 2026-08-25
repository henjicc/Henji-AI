/** @vitest-environment jsdom */

import { cleanup, fireEvent, render } from '@testing-library/react';
import type { CSSProperties, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AssetGroupNodeData } from '@/features/canvas/domain/canvasNodes';
import { getSocketColor } from '@/features/canvas/domain/socketTypes';
import { NODE_PORT_VISIBLE_CLASS } from '@/features/canvas/ui/nodeControlStyles';
import { AssetGroupNode } from './AssetGroupNode';

const mocks = vi.hoisted(() => ({
  publish: vi.fn(),
  updateNodeData: vi.fn(),
  nodes: [] as Array<Record<string, unknown>>,
}));

vi.mock('react-i18next', async (importOriginal) => ({
  ...await importOriginal<typeof import('react-i18next')>(),
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@xyflow/react', () => ({
  Position: { Right: 'right' },
  Handle: ({ className, style, ...props }: {
    className?: string;
    style?: CSSProperties;
    type: string;
    id: string;
    children?: ReactNode;
    'aria-label'?: string;
    title?: string;
  }) => (
    <div
      data-testid="source-handle"
      data-handle-class={className}
      data-handle-type={props.type}
      data-handle-id={props.id}
      aria-label={props['aria-label']}
      title={props.title}
      style={style}
    />
  ),
}));

vi.mock('@/features/canvas/application/canvasServices', () => ({
  canvasEventBus: { publish: mocks.publish },
}));

vi.mock('@/stores/canvasStore', () => ({
  useCanvasStore: (selector: (state: Record<string, unknown>) => unknown) => selector({
    nodes: mocks.nodes,
    updateNodeData: mocks.updateNodeData,
  }),
}));

vi.mock('@/features/canvas/ui/NodeHeader', () => ({
  NodeHeader: ({ headerAdjust, rightSlotAdjust, rightSlot }: {
    headerAdjust?: unknown;
    rightSlotAdjust?: unknown;
    rightSlot?: ReactNode;
  }) => (
    <div
      data-testid="node-header"
      data-header-adjust={JSON.stringify(headerAdjust)}
      data-right-slot-adjust={JSON.stringify(rightSlotAdjust)}
    >
      {rightSlot}
    </div>
  ),
}));

vi.mock('@/features/canvas/ui/NodeResizeHandle', () => ({
  NodeResizeHandle: (props: Record<string, number>) => (
    <div data-testid="resize-handle" data-resize={JSON.stringify(props)} />
  ),
}));

vi.mock('@/features/canvas/nodes/assetGroup/AssetGroupPreview', () => ({
  AssetGroupPreview: () => <div data-testid="asset-group-preview" />,
}));

const data: AssetGroupNodeData = {
  displayName: '角色素材',
  memberOrder: [],
  coverMemberId: null,
  bindings: [],
};

describe('AssetGroupNode', () => {
  beforeEach(() => {
    mocks.publish.mockReset();
    mocks.updateNodeData.mockReset();
    mocks.nodes = [];
  });

  afterEach(cleanup);

  it('内部标题不再套用浮动偏移，并提供完整缩放范围', () => {
    const rendered = render(
      <AssetGroupNode id="group-1" data={data} selected />,
    );

    expect(rendered.getByTestId('node-header').dataset.headerAdjust)
      .toBe(JSON.stringify({ x: 0, y: 0, scale: 1 }));
    expect(rendered.getByTestId('node-header').dataset.rightSlotAdjust)
      .toBe(JSON.stringify({ x: 0, y: 0, scale: 1 }));
    expect(JSON.parse(rendered.getByTestId('resize-handle').dataset.resize ?? '{}')).toEqual({
      minWidth: 220,
      minHeight: 144,
      maxWidth: 2200,
      maxHeight: 1600,
    });
  });

  it('选中时显示有语义颜色的连接端口，并能打开管理工作面', () => {
    const rendered = render(
      <AssetGroupNode id="group-1" data={data} selected />,
    );
    const handle = rendered.getByTestId('source-handle');
    const colorReference = document.createElement('div');
    colorReference.style.background = getSocketColor('*');

    expect(handle.dataset.handleClass).toContain(NODE_PORT_VISIBLE_CLASS);
    expect(handle.style.background).toBe(colorReference.style.background);
    expect(handle.style.transform).toBe('translate(50%, -50%)');
    expect(handle.getAttribute('aria-label')).toBe('canvas.assetGroup.manager.connect');

    fireEvent.click(rendered.getByRole('button', { name: 'canvas.assetGroup.manager.open' }));
    expect(mocks.publish).toHaveBeenCalledWith('asset-group/open', { groupId: 'group-1' });
  });

  it('已有素材组连接时，即使未选中也保持端口可见', () => {
    const rendered = render(
      <AssetGroupNode
        id="group-1"
        data={{
          ...data,
          bindings: [{
            id: 'binding-1',
            targetNodeId: 'target-1',
            targetPortByKind: { image: 'param:__image' },
            excludedMemberIds: [],
          }],
        }}
        selected={false}
      />,
    );

    expect(rendered.getByTestId('source-handle').dataset.handleClass)
      .toContain(NODE_PORT_VISIBLE_CLASS);
  });
});
