// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useNodeHandlesSync } from './useNodeHandlesSync';

const mocks = vi.hoisted(() => ({ update: vi.fn(), getState: vi.fn(), useStoreApi: vi.fn(), useUpdate: vi.fn() }));
vi.mock('@xyflow/react', () => ({ useStoreApi: mocks.useStoreApi, useUpdateNodeInternals: mocks.useUpdate }));

function Node({ id, signature = 'image' }: { id: string; signature?: string }) {
  useNodeHandlesSync(id, signature);
  return null;
}
async function flush() { await act(async () => { await Promise.resolve(); }); }

describe('画布端口测量调度', () => {
  beforeEach(() => {
    mocks.update.mockReset();
    // useStoreApi 的包装对象可以不同，底层 store 身份保持不变。
    mocks.useStoreApi.mockImplementation(() => ({ getState: mocks.getState }));
    mocks.useUpdate.mockReturnValue(mocks.update);
  });
  afterEach(async () => { cleanup(); await flush(); });

  it('千节点挂载合并为一次测量，保留每个节点', async () => {
    const ids = Array.from({ length: 1000 }, (_, i) => `node-${i}`);
    render(<>{ids.map(id => <Node key={id} id={id} />)}</>);
    await flush();
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(mocks.update).toHaveBeenCalledWith(ids);
  });

  it('联动只测量变化节点，撤销尚未提交的过期和卸载请求', async () => {
    const view = render(<Node id="first" />);
    view.rerender(<Node id="second" signature="video" />);
    await flush();
    expect(mocks.update).toHaveBeenCalledWith(['second']);
    view.rerender(<Node id="second" signature="video" />);
    await flush();
    expect(mocks.update).toHaveBeenCalledTimes(1);
    view.rerender(<Node id="second" signature="audio" />);
    await flush();
    expect(mocks.update).toHaveBeenCalledTimes(2);
    view.rerender(<Node id="third" />);
    view.unmount();
    await flush();
    expect(mocks.update).toHaveBeenCalledTimes(2);
  });

  it('同名节点按画布实例隔离，同一节点的多个请求去重', async () => {
    render(<><Node id="shared" /><Node id="shared" signature="video" /></>);
    const secondUpdate = vi.fn();
    mocks.useStoreApi.mockReturnValue({ getState: vi.fn() });
    mocks.useUpdate.mockReturnValue(secondUpdate);
    render(<Node id="shared" />);
    await flush();
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(mocks.update).toHaveBeenCalledWith(['shared']);
    expect(secondUpdate).toHaveBeenCalledTimes(1);
    expect(secondUpdate).toHaveBeenCalledWith(['shared']);
  });
});
