import { describe, expect, it } from 'vitest';
import { canvasAnchorSchemaV3, canvasSizeTransformV3, createDocumentGeometryCommandV3, documentSizeSchemaV3 } from '.';
import { createImageEditDocumentV3, createImageEditRasterLayerV3 } from '../documentFactory';
import { ImageEditCommandHistoryV3 } from '../commandHistory';
import { appendImageEditSelectionV3, imageEditSelectionSessionSchemaV3 } from '../selection/session';
import { createImageEditSparseMaskReferenceV3 } from '../layerTypes';
describe('图片尺寸与九点锚点', () => {
  it.each(canvasAnchorSchemaV3.options)('%s 锚点扩缩边界，保持锁定层原始网格与独立蒙版，一次撤销', anchor => {
    const document = createImageEditDocumentV3({ width: 100, height: 80 }), output = { width: 60, height: 120 }, transform = canvasSizeTransformV3(document.geometry, output, anchor);
    const layer = { ...createImageEditRasterLayerV3('base', '原稿'), locked: true, mask: createImageEditSparseMaskReferenceV3('mask'), maskAttachment: { enabled: true, linked: false, density: 1, transform: [1, 0, 0, 1, 10, 20] as const } };
    document.layers = [layer]; document.namedRegions = [{ id: 'region', name: '主体', selection: appendImageEditSelectionV3(null, { type: 'rectangle', x: .1, y: .2, width: .5, height: .6 }, 'replace') }];
    const history = new ImageEditCommandHistoryV3(), resized = history.execute(document, createDocumentGeometryCommandV3(document, output, transform, 'size'));
    expect(resized.layers[0]).toMatchObject({ locked: true, transform, rasterCanvasSize: { width: 100, height: 80 }, maskAttachment: { transform: [1, 0, 0, 1, 10 + transform[4], 20 + transform[5]] } });
    expect(imageEditSelectionSessionSchemaV3.safeParse(resized.namedRegions[0].selection).success).toBe(true);
    expect(history.undo(resized).document).toMatchObject({ geometry: document.geometry, layers: document.layers, namedRegions: document.namedRegions });
  });
  it('保留画布外有限区域，不设产品尺寸上限，拒绝非整数或非有限值', () => {
    expect(documentSizeSchemaV3.parse({ width: 100000, height: 50000 })).toEqual({ width: 100000, height: 50000 });
    expect(imageEditSelectionSessionSchemaV3.parse(appendImageEditSelectionV3(null, { type: 'rectangle', x: -2, y: 3, width: 5, height: 2 }, 'replace'))).toBeDefined();
    for (const width of [0, -1, .5, Infinity, NaN]) expect(documentSizeSchemaV3.safeParse({ width, height: 1 }).success).toBe(false);
  });
});
