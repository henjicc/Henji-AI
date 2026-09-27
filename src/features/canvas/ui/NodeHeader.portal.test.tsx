/** @vitest-environment jsdom */

import { act, cleanup, render } from '@testing-library/react';
import { ReactFlowProvider, useStoreApi } from '@xyflow/react';
import { afterEach, expect, it, vi } from 'vitest';
import { NodeHeader } from './NodeHeader';

// 只替换节点几何；保留正式 ReactFlow store、订阅和 portal 生命周期。
vi.mock('@xyflow/react', async (importOriginal) => ({
  ...await importOriginal<typeof import('@xyflow/react')>(),
  useNodeId: () => 'node-1',
  useInternalNode: () => ({
    measured: { width: 420, height: 240 },
    internals: { positionAbsolute: { x: 120, y: 80 }, z: 3, userNode: {} },
  }),
}));

afterEach(() => { cleanup(); document.body.replaceChildren(); vi.restoreAllMocks(); });

it('标题命中层在宿主就绪和替换时挂载，平移不重复查找 DOM，卸载清理', () => {
  let store!: ReturnType<typeof useStoreApi>;
  function Headers() {
    store = useStoreApi();
    return <>{Array.from({ length: 100 }, (_, index) => <NodeHeader key={index} titleText={`节点 ${index}`} />)}</>;
  }
  const view = render(<ReactFlowProvider><Headers /></ReactFlowProvider>);
  const createRoot = () => {
    const root = document.createElement('div');
    const portal = document.createElement('div');
    portal.className = 'react-flow__viewport-portal';
    root.appendChild(portal);
    document.body.appendChild(root);
    return { root, portal };
  };
  const first = createRoot();
  const query = vi.spyOn(first.root, 'querySelector');
  act(() => store.setState({ domNode: first.root }));
  expect(first.portal.childElementCount).toBe(100);
  expect(query).toHaveBeenCalledTimes(1);
  query.mockClear();
  for (let frame = 0; frame < 30; frame++) {
    act(() => store.setState({ transform: [frame * -9, 80, 0.5] }));
  }
  expect(query.mock.calls.length).toBe(0);
  expect(first.portal.childElementCount).toBe(100);
  const second = createRoot();
  act(() => store.setState({ domNode: second.root }));
  expect(first.portal.childElementCount).toBe(0);
  expect(second.portal.childElementCount).toBe(100);
  view.unmount();
  expect(second.portal.childElementCount).toBe(0);
});
