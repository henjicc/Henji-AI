import { beforeEach, describe, expect, it } from 'vitest';

import { usePanoramaInlineViewerStore } from './panoramaInlineViewerStore';

describe('panoramaInlineViewerStore', () => {
  beforeEach(() => {
    usePanoramaInlineViewerStore.setState({ activeNodeId: null });
  });

  it('同一时刻只把内嵌球面渲染租约交给一个节点', () => {
    const store = usePanoramaInlineViewerStore.getState();
    store.claim('panorama-a');
    expect(usePanoramaInlineViewerStore.getState().activeNodeId).toBe('panorama-a');

    store.claim('panorama-b');
    expect(usePanoramaInlineViewerStore.getState().activeNodeId).toBe('panorama-b');

    store.release('panorama-a');
    expect(usePanoramaInlineViewerStore.getState().activeNodeId).toBe('panorama-b');

    store.release('panorama-b');
    expect(usePanoramaInlineViewerStore.getState().activeNodeId).toBeNull();
  });
});
