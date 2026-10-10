import { describe, expect, it } from 'vitest';
import { createImageEditDocumentV3, createImageEditRasterLayerV3, createImageEditEffectLayerV3 } from '../documentFactory';
import { createImageEditLayerCommonV3, type ImageEditSmartLayerV3 } from '../layerTypes';
import { ImageEditCommandHistoryV3 } from '../commandHistory';
import { decodeImageEditCommandHistorySnapshotV3 } from '../commandHistoryCodec';
import { rasterizeVectorCoverage } from '../../../imaging/vectorContent';
import { appendImageEditSelectionV3 } from '../selection/session';
import { createImageEditOutpaintCommandV3, planImageEditOutpaintV3, rebaseImageEditSelectionForOutpaintV3 } from './outpaint';

function sample() {
  const document = createImageEditDocumentV3({ width: 100, height: 80, documentId: 'outpaint-doc' });
  document.layers = [{ ...createImageEditRasterLayerV3('original', '原图'), locked: true }];
  const layer: ImageEditSmartLayerV3 = { ...createImageEditLayerCommonV3('generated', 'AI 扩图'), type: 'smart', source: { kind: 'empty' }, tiles: {},
    content: { id: 'content', origin: { kind: 'generation.result', id: 'task' }, document: createImageEditDocumentV3({ width: 150, height: 120 }), width: 150, height: 120 } };
  return { document, layer };
}
describe('扩图：同一命令历史与共享区域内核', () => {
  it('锁定原图网格、蒙版只显示新增边缘，扩边与新层一次撤销并可序列化', () => {
    const { document, layer } = sample(), plan = planImageEditOutpaintV3(document, { right: .5, bottom: .5 });
    const history = new ImageEditCommandHistoryV3();
    const next = history.execute(document, createImageEditOutpaintCommandV3(document, plan, layer, {}, 'expand'));
    expect(next.geometry).toMatchObject({ width: 150, height: 120 });
    expect(next.layers[0]).toMatchObject({ id: 'original', locked: true, rasterCanvasSize: { width: 100, height: 80 } });
    const mask = next.layers[1].mask!;
    const originalCoverage = rasterizeVectorCoverage(mask.vectorPaths!, { x: 99, y: 79, width: 2, height: 2 });
    expect([...originalCoverage]).toEqual([0, 1, 1, 1]);
    const restored = decodeImageEditCommandHistorySnapshotV3(history.createSnapshot()).snapshot;
    expect(restored.undo).toHaveLength(1);
    const undone = history.undo(next).document;
    expect(undone.layers).toEqual(document.layers); expect(undone.geometry).toEqual(document.geometry);
    expect(history.redo(undone).document.layers).toEqual(next.layers);
  });
  it('等待期间画幅变化拒绝落位，普通内容修改允许；源时间按有理 ticks 保留', () => {
    const { document, layer } = sample(), time = { kind: 'frame' as const, ticks: 12, timeBase: [1, 24] as const, frameId: 'frame-12' };
    const plan = planImageEditOutpaintV3(document, { right: .25, bottom: 0 }, time);
    expect(plan.time).toEqual(time);
    expect(() => createImageEditOutpaintCommandV3({ ...document, revision: 42 }, plan, layer, {}, 'later')).not.toThrow();
    expect(() => createImageEditOutpaintCommandV3({ ...document, geometry: { ...document.geometry, width: 200 } }, plan, layer, {}, 'late')).toThrow('原画幅已变化');
    expect(() => createImageEditOutpaintCommandV3({ ...document, color: { ...document.color, workingSpace: 'display-p3' } }, plan, layer, {}, 'late-color')).toThrow('HDR');
    expect(() => createImageEditOutpaintCommandV3({ ...document, geometry: { ...document.geometry, orientation: { rotate: 90, mirrored: false } } }, plan, layer, {}, 'late-rotation')).toThrow('方向');
  });
  it('命名区域与软覆盖矩阵保持像素位置、刷半径和羽化', () => {
    const { document } = sample(), plan = planImageEditOutpaintV3(document, { right: 1, bottom: 1 });
    const selection = { ...appendImageEditSelectionV3(null, { type: 'brush', points: [{ x: .4, y: .5 }], radius: .1 }, 'replace'), feather: .02 };
    expect(rebaseImageEditSelectionForOutpaintV3(selection, plan)).toMatchObject({ feather: .01, operations: [{ shape: { radius: .05, points: [{ x: .2, y: .25 }] } }] });
  });
  it('不限制合理扩展规模，拒绝无新增像素、旋转、HDR 和非有限尺寸', () => {
    const { document } = sample();
    expect(planImageEditOutpaintV3(document, { right: 100, bottom: 0 }).output.width).toBe(10100);
    expect(() => planImageEditOutpaintV3(document, { right: .00001, bottom: 0 })).toThrow('至少一个像素');
    expect(() => planImageEditOutpaintV3({ ...document, color: { ...document.color, transferFunction: 'pq' } }, { right: 1, bottom: 0 })).toThrow('HDR');
    expect(() => planImageEditOutpaintV3({ ...document, geometry: { ...document.geometry, orientation: { rotate: 90, mirrored: false } } }, { right: 1, bottom: 0 })).toThrow('方向');
    expect(() => planImageEditOutpaintV3(document, { right: Infinity, bottom: 0 })).toThrow();
  });
  it('依赖画幅的效果先拒绝；嵌入智能内容保持独立画幅，可扩图', () => {
    const { document, layer } = sample();
    document.layers.push(createImageEditEffectLayerV3('blur', '柔化', 'blur', {}));
    expect(() => planImageEditOutpaintV3(document, { right: .25, bottom: 0 })).toThrow('智能对象');
    layer.content.document = document;
    const host = createImageEditDocumentV3({ width: 150, height: 120 }); host.layers = [layer];
    expect(() => planImageEditOutpaintV3(host, { right: .25, bottom: 0 })).not.toThrow();
  });
});
