import { encodeTransferFunctionV3 } from '@/core/imaging/colorManagement';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createImageEditDocumentV3 } from '@/core/imageEdit/v3/documentFactory';
import { embedImageEditRasterV3 } from '@/core/imageEdit/v3/smartContent/commands';
import { ImageEditCommandBusV3 } from '../application/imageEditCommandBus';

const mocks = vi.hoisted(() => ({ pin: vi.fn(), release: vi.fn(), persist: vi.fn(), render: vi.fn(), source: vi.fn(), load: vi.fn(), ingest: vi.fn() }));
vi.mock('@/commands/imageEditorV3', () => ({ pinImageEditorV3RepairResources: mocks.pin, releaseImageEditorV3RepairResources: mocks.release,
  persistImageEditorV3BrushTiles: mocks.persist, ingestImageEditorV3Source: mocks.ingest }));
vi.mock('../export/renderExportTilesV3', () => ({ renderImageEditorV3ExportTiles: mocks.render }));
vi.mock('../../application/imageSourceCapabilityService', () => ({ resolveImageSource: mocks.source }));
vi.mock('../application/imageEditDocumentLoading', () => ({ ensureImageEditDocumentInstanceV3: mocks.load }));
import { prepareSmartContentAppearanceV3, prepareSmartContentMutationV3, resolveSmartContentSourceV3, updateSmartContentV3 } from './service';
import { releaseSmartContentResourcesV3 } from './resourceLeases';

const sourceId = `sha256:${'a'.repeat(64)}`, cacheId = `sha256:${'b'.repeat(64)}`;
function fixture() {
  const document = createImageEditDocumentV3({ width: 1, height: 1, documentId: 'parent', sourceResourceId: sourceId });
  const layer = embedImageEditRasterV3(document, document.layers[0].id);
  document.layers = [layer, { ...structuredClone(layer), id: 'other', transform: [1, 0, 0, 1, 20, 0] }];
  const bus = new ImageEditCommandBusV3(document, { resourceByteSizes: { [sourceId]: 100 } });
  return { document, layer, bus };
}
beforeEach(() => {
  vi.clearAllMocks(); mocks.pin.mockResolvedValue(undefined); mocks.release.mockResolvedValue(undefined);
  mocks.persist.mockResolvedValue({ tiles: [{ tileKey: '0/0/0', resourceId: cacheId, byteSize: 64 }] });
  mocks.render.mockImplementation(async function* (request) { yield { x: 0, y: 0, width: 1, height: 1, rowStride: 16, pixels: Float32Array.from([.4, .2, .1].map(value => encodeTransferFunctionV3(value, request.description.transferFunction)).concat(.5)).buffer }; });
});
describe('智能内容物化和正式实例安全', () => {
  it('通用写入准备后未发布立即释放；发布后由保存确认持有缓存', async () => {
    const { bus, layer } = fixture();
    const abandoned = await prepareSmartContentMutationV3(bus, layer.id, { smartDocument: layer.content.document });
    await abandoned.release?.(); expect(mocks.release).toHaveBeenCalledTimes(1);
    const published = await prepareSmartContentMutationV3(bus, layer.id, { smartDocument: layer.content.document });
    for (const command of published.commands) bus.dispatch(command);
    await published.release?.(); expect(mocks.release).toHaveBeenCalledTimes(1);
    await releaseSmartContentResourcesV3(bus); expect(mocks.release).toHaveBeenCalledTimes(2); bus.dispose();
  });
  it('正式实例在通用准备期间关闭时取消计算并释放未发布缓存', async () => {
    const { bus, layer } = fixture();
    mocks.render.mockImplementation(async function* () { bus.dispose(); yield { x: 0, y: 0, width: 1, height: 1, rowStride: 16, pixels: new Float32Array(4).buffer }; });
    await expect(prepareSmartContentMutationV3(bus, layer.id, { smartDocument: layer.content.document })).rejects.toThrow();
    expect(mocks.persist).not.toHaveBeenCalled(); expect(mocks.release).toHaveBeenCalledTimes(1);
  });
  it('HDR 参考白和 SDR ICC 沿原导出契约保留，不清空元数据伪装 SDR', async () => {
    const { document, layer, bus } = fixture();
    const hdr = structuredClone(layer.content.document);
    hdr.color = { ...hdr.color, workingSpace: 'rec2020', bitDepth: 'float32', transferFunction: 'pq', hdrMetadata: { standard: 'pq', referenceWhiteNits: 1000,
      cicp: { colorPrimaries: 9, transferCharacteristics: 16, matrixCoefficients: 9, fullRange: false } } };
    const appearance = await prepareSmartContentAppearanceV3(hdr, document, { [sourceId]: 100 }); await appearance.release();
    expect(mocks.render.mock.calls[0][0].document.color).toEqual(hdr.color);
    expect(mocks.render.mock.calls[0][0].description).toMatchObject({ bitDepth: 32, transferFunction: 'linear' });
    const icc = structuredClone(layer.content.document); icc.color.iccProfileResourceId = sourceId;
    const profileAppearance = await prepareSmartContentAppearanceV3(icc, document, { [sourceId]: 100 }); await profileAppearance.release();
    expect(mocks.render.mock.calls[1][0].document.color.iccProfileResourceId).toBe(sourceId);
    expect(mocks.render.mock.calls[1][0].document.color.transferFunction).toBe(icc.color.transferFunction);
    expect(mocks.render.mock.calls[1][0].description.transferFunction).toBe(icc.color.transferFunction);
    expect(mocks.render.mock.calls[1][0].description.iccProfileResourceRef).toBe(sourceId);
    bus.dispose();
  });
  it('其他窗口已更新内容时拒绝旧草稿，不物化或重放旧修改', async () => {
    const { bus, layer } = fixture();
    await updateSmartContentV3(bus, layer.id, { ...layer.content.document, revision: 1 });
    mocks.render.mockClear();
    await expect(updateSmartContentV3(bus, layer.id, layer.content.document, { expectedContent: layer.content })).rejects.toThrow(/已更新/);
    expect(mocks.render).not.toHaveBeenCalled(); expect(bus.getSnapshot().history.undoCount).toBe(1);
    await releaseSmartContentResourcesV3(bus); bus.dispose();
  });
  it('使用浮点导出，预乘 alpha，逐块落盘，取消前不发布', async () => {
    const { document, layer } = fixture();
    const appearance = await prepareSmartContentAppearanceV3(layer.content.document, document, { [sourceId]: 100 });
    expect(mocks.render.mock.calls[0][0].description.bitDepth).toBe(32);
    for (const [index, value] of [.2, .1, .05, .5].entries()) expect(mocks.persist.mock.calls[0][0].tiles[0].tile.data[index]).toBeCloseTo(value, 6);
    expect(appearance.bytes[cacheId]).toBe(64); await appearance.release();
    const cancelled = new AbortController(); cancelled.abort();
    await expect(prepareSmartContentAppearanceV3(layer.content.document, document, {}, cancelled.signal)).rejects.toThrow();
    expect(mocks.persist).toHaveBeenCalledTimes(1);
  });
  it('共享内容一次提交；保存失败保留修改与资源，重试仅保存', async () => {
    const { bus, layer } = fixture();
    await expect(updateSmartContentV3(bus, layer.id, { ...layer.content.document, revision: 2 }, { confirm: async () => { throw new Error('磁盘不可写'); } })).rejects.toThrow('磁盘不可写');
    expect(bus.getSnapshot().history.undoCount).toBe(1);
    expect(bus.getResourceByteSizes()[cacheId]).toBe(64);
    expect(bus.getSnapshot().document.layers.every(item => item.type === 'smart' && item.content.document.revision === 2)).toBe(true);
    expect(mocks.release).not.toHaveBeenCalled();
    await releaseSmartContentResourcesV3(bus); expect(mocks.release).toHaveBeenCalledTimes(1);
    bus.undo(); expect(bus.getSnapshot().document.layers[0]).toEqual(layer);
    bus.dispose();
  });
  it('准备时删除、变化或取消拒绝迟到内容，释放未发布资源', async () => {
    const { bus, layer } = fixture();
    mocks.render.mockImplementation(async function* () {
      bus.dispatch({ type: 'layer.delete', commandId: 'delete', expectedRevision: 0, layerId: layer.id });
      yield { x: 0, y: 0, width: 1, height: 1, rowStride: 16, pixels: new Float32Array(4).buffer };
    });
    await expect(updateSmartContentV3(bus, layer.id, layer.content.document)).rejects.toThrow(/已改变/);
    expect(bus.getSnapshot().document.layers).toHaveLength(1); expect(mocks.release).toHaveBeenCalledTimes(1); bus.dispose();
  });
  it('缺失资源与内容循环失败，不影响父文档或历史', async () => {
    const { bus, layer } = fixture();
    mocks.render.mockImplementation(async function* () { throw new Error('资源缺失'); yield undefined; });
    await expect(updateSmartContentV3(bus, layer.id, layer.content.document)).rejects.toThrow('资源缺失');
    expect(bus.getSnapshot().history.undoCount).toBe(0); expect(mocks.release).toHaveBeenCalledTimes(1);
    const cyclic = { ...layer.content.document, layers: [{ ...structuredClone(layer), id: 'nested' }] };
    await expect(updateSmartContentV3(bus, layer.id, cyclic)).rejects.toThrow(/循环|无效/); bus.dispose();
  });
  it('通用类型写入使用同一转换命令，原图资源与内容读回保留', async () => {
    const document = createImageEditDocumentV3({ width: 1, height: 1, sourceResourceId: sourceId });
    const bus = new ImageEditCommandBusV3(document, { resourceByteSizes: { [sourceId]: 100 } });
    const result = await prepareSmartContentMutationV3(bus, document.layers[0].id, { contentType: 'smart' });
    bus.dispatch(result.commands[0]); expect(bus.getSnapshot().document.layers[0].type).toBe('smart'); bus.dispose();
  });
  it('图片文档来源从正式实例读取，生成结果复用现有解析与受管上传', async () => {
    const { bus, document } = fixture(); mocks.load.mockResolvedValue({ bus });
    expect((await resolveSmartContentSourceV3({ kind: 'image_edit.document', id: 'v3:parent' })).document).toEqual(document);
    mocks.source.mockResolvedValue({ source: '/managed.png' });
    mocks.ingest.mockResolvedValue({ metadata: { width: 1, height: 1, format: 'png', bitsPerSample: 8, depth: 'uchar', hdr: false, colorSpace: 'srgb', bitDepth: 8, transferFunction: 'srgb' }, resource: { resourceRef: sourceId, byteLength: 100 } });
    expect((await resolveSmartContentSourceV3({ kind: 'generation.result', id: 'result' })).document.layers).toHaveLength(1);
    expect(mocks.source).toHaveBeenCalledWith({ kind: 'generation.result', id: 'result' }); bus.dispose();
  });
});
