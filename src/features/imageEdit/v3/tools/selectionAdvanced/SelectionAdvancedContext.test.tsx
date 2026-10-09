/** @vitest-environment jsdom */
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createImageEditDocumentV3, createImageEditRasterLayerV3 } from '@/core/imageEdit/v3/documentFactory';
import { appendImageEditSelectionV3 } from '@/core/imageEdit/v3/selection/session';
import { ImageEditCommandBusV3 } from '../../application/imageEditCommandBus';
import { useImageEditorSessionStoreV3 } from '../../store';
import { previewImageEditSelectionIntentV3 } from './service';
import { SelectionAdvancedProviderV3, useSelectionAdvancedV3 } from './SelectionAdvancedContext';

vi.mock('./service', () => ({ previewImageEditSelectionIntentV3: vi.fn(), applyImageEditSelectionPreviewV3: vi.fn() }));
afterEach(() => { cleanup(); useImageEditorSessionStoreV3.setState({ sessions: {} }); vi.clearAllMocks(); });

describe('专业选区的运行基线切换', () => {
  it.each(['document', 'selection'] as const)('切换 %s 时同步取消，不展示内部取消错误或写入迟到结果', async kind => {
    const document = createImageEditDocumentV3({ width: 8, height: 4 });
    document.layers = [createImageEditRasterLayerV3('raster', '原图')];
    const bus = new ImageEditCommandBusV3(document);
    const store = useImageEditorSessionStoreV3.getState();
    store.ensureSession('selection-test', ['select-focus'], 'raster', 'select-focus');
    let signal: AbortSignal | undefined;
    vi.mocked(previewImageEditSelectionIntentV3).mockImplementation((_bus, _layer, _intent, _mode, options = {}) => new Promise((_resolve, reject) => {
      signal = options.signal;
      signal?.addEventListener('abort', () => reject(new Error('CANCELLED')), { once: true });
    }));
    let view: ReturnType<typeof useSelectionAdvancedV3> = null;
    function Probe(): null { view = useSelectionAdvancedV3(); return null; }
    render(<SelectionAdvancedProviderV3 bus={bus} controller={{ sessionId: 'selection-test' }}><Probe /></SelectionAdvancedProviderV3>);
    const current = (): NonNullable<typeof view> => { if (!view) throw new Error('缺少选区上下文'); return view; };
    let running: Promise<void> = Promise.resolve();
    act(() => { running = current().run(); });
    expect(current().busy).toBe(true);
    act(() => {
      if (kind === 'document') bus.dispatch({ type: 'layer.update-common', layerId: 'raster', patch: { opacity: .5 }, commandId: 'external-change', expectedRevision: 0 });
      else bus.setSelection(appendImageEditSelectionV3(null, { type: 'rectangle', x: .1, y: .1, width: .5, height: .5 }, 'replace'));
    });
    await act(async () => { await running; });
    expect(signal?.aborted).toBe(true);
    expect(current()).toMatchObject({ busy: false, error: null, preview: null });
    expect(bus.getSnapshot().document.revision).toBe(kind === 'document' ? 1 : 0);
    expect(bus.getSnapshot().selectionRevision).toBe(kind === 'document' ? 0 : 1);
    bus.dispose();
  });
});
