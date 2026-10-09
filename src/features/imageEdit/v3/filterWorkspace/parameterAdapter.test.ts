import { projectImageEditorPreviewDocumentV3 } from '../execution/previewDocumentV3';
/** @vitest-environment jsdom */
import '@/tests/imageEditDocumentFixture';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { createImageEditDocumentV3, createImageEditRasterLayerV3 } from '@/core/imageEdit/v3/documentFactory';
import { useImageEditorControllerV3 } from '../editor/useImageEditorControllerV3';
import { imageEditFilterParameterAdapterV3, imageEditFilterMixPreviewV3 } from './parameterAdapter';

afterEach(cleanup);
describe('filter parameter completion', () => {
  it('混合强度跟手投影，取消不写历史；快提交与一次撤销保留权威值', () => {
    const document = createImageEditDocumentV3({ width: 32, height: 24 });
    const layer = createImageEditRasterLayerV3('base', '底图');
    layer.filters = [{ id: 'local', operationType: 'adjustment', effectId: 'exposure', params: { stops: 1 }, enabled: true, opacity: 1, blendMode: 'normal', mask: null }];
    document.layers = [layer];
    const { result } = renderHook(() => useImageEditorControllerV3({ document, profileId: 'full', onDocumentChange: () => undefined }));
    const gesture = imageEditFilterMixPreviewV3(result.current.controller, layer, 'local', 'mix');
    act(() => gesture.write(.3));
    expect(projectImageEditorPreviewDocumentV3(result.current.bus.getSnapshot()).layers[0].filters[0].opacity).toBe(.3);
    expect(result.current.bus.getSnapshot().document.layers[0].filters[0].opacity).toBe(1);
    act(() => gesture.cancel()); expect(result.current.bus.getSnapshot().history.undoCount).toBe(0);
    expect(projectImageEditorPreviewDocumentV3(result.current.bus.getSnapshot()).layers[0].filters[0].opacity).toBe(1);
    act(() => gesture.finish(.6)); expect(result.current.bus.getSnapshot().history.undoCount).toBe(1);
    act(() => result.current.controller.undo()); expect(result.current.bus.getSnapshot().document.layers[0].filters[0].opacity).toBe(1);
  });
  it.each([false, true])('commits once with an existing preview frame: %s', previewHasRun => {
    const document = createImageEditDocumentV3({ width: 32, height: 24 });
    const layer = createImageEditRasterLayerV3('base', '底图');
    layer.filters = [{ id: 'blur', operationType: 'effect', effectId: 'gaussian_blur',
      params: { sigma_fraction_height: 0.009 }, enabled: true, opacity: 1, blendMode: 'normal', mask: null }];
    document.layers = [layer];
    const { result } = renderHook(() => useImageEditorControllerV3({ document, profileId: 'full', onDocumentChange: () => undefined }));
    const adapted = imageEditFilterParameterAdapterV3(result.current.controller, layer, layer.filters[0]);
    act(() => {
      if (previewHasRun) adapted.controller.setParameterPreview('gesture', 'blur', { sigma_fraction_height: 0.015 });
      adapted.controller.commitLayerParamsPreview('gesture', 'blur', { sigma_fraction_height: 0.02 });
    });
    expect(result.current.bus.getSnapshot().document.layers[0].filters[0].params).toEqual({ sigma_fraction_height: 0.02 });
    expect(result.current.bus.getSnapshot().history.undoCount).toBe(1);
    act(() => result.current.controller.undo());
    expect(result.current.bus.getSnapshot().document.layers[0].filters[0].params).toEqual({ sigma_fraction_height: 0.009 });
    act(() => result.current.controller.redo());
    expect(result.current.bus.getSnapshot().document.layers[0].filters[0].params).toEqual({ sigma_fraction_height: 0.02 });
  });
});
