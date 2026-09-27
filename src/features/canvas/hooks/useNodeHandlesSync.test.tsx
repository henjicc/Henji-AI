// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useNodeHandlesSync } from './useNodeHandlesSync';

const mocks = vi.hoisted(() => ({ update: vi.fn(), getState: vi.fn(), useStoreApi: vi.fn() }));
vi.mock('@xyflow/react', () => ({ useStoreApi: mocks.useStoreApi }));

function Node({ id, signature = 'image' }: { id: string; signature?: string }) {
  useNodeHandlesSync(id, signature);
  return null;
}
async function flush() { await act(async () => { await Promise.resolve(); }); }

function createFlowDom(ids: string[]): HTMLDivElement {
  const root = document.createElement('div');
  for (const id of ids) {
    const element = document.createElement('div');
    element.className = 'react-flow__node';
    element.dataset.id = id;
    root.append(element);
  }
  return root;
}

describe('画布端口测量调度', () => {
  let frames: FrameRequestCallback[];
  const frame = () => act(() => { const queued = frames; frames = []; queued.forEach(callback => callback(0)); });
  beforeEach(() => {
    frames = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback));
    mocks.update.mockReset();
    mocks.getState.mockReturnValue({ domNode: createFlowDom(['first', 'second', 'third']), updateNodeInternals: mocks.update });
    mocks.useStoreApi.mockImplementation(() => ({ getState: mocks.getState }));
  });
  afterEach(async () => { cleanup(); await flush(); vi.unstubAllGlobals(); });

  it('千节点只扫描一次 DOM，下一帧批量测量所有节点且不触发 fitView', async () => {
    const ids = Array.from({ length: 1000 }, (_, i) => `node-${i}`);
    const domNode = createFlowDom(ids);
    const scan = vi.spyOn(domNode, 'querySelectorAll');
    const individualScan = vi.spyOn(domNode, 'querySelector');
    mocks.getState.mockReturnValue({ domNode, updateNodeInternals: mocks.update });
    render(<>{ids.map(id => <Node key={id} id={id} />)}</>);
    await flush();
    expect(scan).toHaveBeenCalledTimes(1);
    expect(individualScan).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    frame();
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(mocks.update).toHaveBeenCalledWith(new Map(ids.map((id, i) => [id, {
      id, nodeElement: domNode.children[i], force: true,
    }])), { triggerFitView: false });
  });

  it('联动只测量变化节点，撤销尚未提交的过期和卸载请求', async () => {
    const view = render(<Node id="first" />);
    view.rerender(<Node id="second" signature="video" />);
    await flush(); frame();
    expect([...mocks.update.mock.calls[0][0].keys()]).toEqual(['second']);
    view.rerender(<Node id="second" signature="video" />);
    await flush(); frame();
    expect(mocks.update).toHaveBeenCalledTimes(1);
    view.rerender(<Node id="second" signature="audio" />);
    await flush(); frame();
    expect(mocks.update).toHaveBeenCalledTimes(2);
    view.rerender(<Node id="third" />);
    view.unmount();
    await flush(); frame();
    expect(mocks.update).toHaveBeenCalledTimes(2);
  });

  it('同名节点按画布实例隔离，同一节点的多个请求去重', async () => {
    const firstRoot = createFlowDom(['shared']);
    mocks.getState.mockReturnValue({ domNode: firstRoot, updateNodeInternals: mocks.update });
    render(<><Node id="shared" /><Node id="shared" signature="video" /></>);
    const secondRoot = createFlowDom(['shared']);
    const secondUpdate = vi.fn();
    mocks.useStoreApi.mockReturnValue({ getState: () => ({ domNode: secondRoot, updateNodeInternals: secondUpdate }) });
    render(<Node id="shared" />);
    await flush(); frame();
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(secondUpdate).toHaveBeenCalledTimes(1);
    expect(mocks.update.mock.calls[0][0].get('shared').nodeElement).toBe(firstRoot.firstChild);
    expect(secondUpdate.mock.calls[0][0].get('shared').nodeElement).toBe(secondRoot.firstChild);
  });

  it('按原始 ID 匹配，忽略缺失节点，空画布不遗留测量', async () => {
    const id = 'node"[special]';
    const domNode = createFlowDom(['last', id, 'unrequested']);
    mocks.getState.mockReturnValue({ domNode, updateNodeInternals: mocks.update });
    const view = render(<><Node id={id} /><Node id="missing" /><Node id="last" /></>);
    await flush(); frame();
    expect([...mocks.update.mock.calls[0][0].keys()]).toEqual([id, 'last']);
    mocks.getState.mockReturnValue({ domNode: null, updateNodeInternals: mocks.update });
    view.rerender(<Node id="unmounted-flow" />);
    await flush(); frame();
    expect(mocks.update).toHaveBeenCalledTimes(1);
  });
});
