import { assignRgbProfilePixels, colorSettingsSchema, type ColorSettings } from '@/core/imaging/colorManagement';
import { createImageEditHdrMetadataV3, type ImageEditColorModeV3 } from '@/core/imageEdit/v3/colorTypes';
import { createImageEditIdV3, createImageEditRasterLayerV3 } from '@/core/imageEdit/v3/documentFactory';
import { createImageEditLayerCommonV3 } from '@/core/imageEdit/v3/layerTypes';
import type { ImageEditCommandV3, ImageEditLeafCommandV3 } from '@/core/imageEdit/v3/commandTypes';
import { prepareImageEditCommandV3 } from '@/core/imageEdit/v3/commandPreparation';
import { createFloat32PremultipliedRgbaTile } from '@/core/imageEdit/v3/effects/contracts';
import { createLogger } from '@/core/logging';
import type { RegionSampleTime } from '@/core/imaging/regions';
import type { ImageEditCommandBusV3 } from '../../application/imageEditCommandBus';
import { prepareSmartContentAppearanceV3 } from '../../smartContent/service';
import { retainSmartContentResourcesV3 } from '../../smartContent/resourceLeases';

const logger = createLogger('features.imageEdit.v3.color_management');

export function colorModeFromSettings(settings: ColorSettings): ImageEditColorModeV3 {
  const hdr = settings.transferFunction === 'pq' || settings.transferFunction === 'hlg';
  return { workingSpace: settings.workingSpace, bitDepth: settings.bitDepth,
    transferFunction: settings.transferFunction,
    hdrMetadata: hdr ? createImageEditHdrMetadataV3(settings.transferFunction as 'pq' | 'hlg') : null,
    iccProfileResourceId: null };
}

/** 同一准备结果供通用属性事务与面板消费；不直接写 Store，不建立另一份历史。 */
export async function prepareColorSettingsV3(bus: ImageEditCommandBusV3, value: unknown,
  options: { signal?: AbortSignal; time?: RegionSampleTime; onProgress?: (completed: number, total: number) => void } = {}) {
  const parsed = colorSettingsSchema.safeParse(value);
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? '请选择有效的颜色配置');
  const settings = parsed.data, original = bus.getSnapshot().document;
  const color = colorModeFromSettings(settings);
  // Reference-white metadata must survive a same-standard precision/gamut operation.
  if (color.hdrMetadata && color.transferFunction === original.color.transferFunction) color.hdrMetadata = structuredClone(original.color.hdrMetadata);
  if (JSON.stringify(color) === JSON.stringify(original.color)) return { commands: [] as ImageEditCommandV3[], release: undefined };
  if (settings.mode === 'convert' && original.color.hdrMetadata && !color.hdrMetadata && color.transferFunction !== 'linear') {
    throw new Error('HDR 转换到标准显示需要显式色调映射；请保留 HDR 或使用线性浮点输出');
  }
  const signal = options.signal ? AbortSignal.any([options.signal, bus.getLifecycleSignal()]) : bus.getLifecycleSignal();
  signal.throwIfAborted();
  logger.info('开始准备颜色调整', { event: 'image_edit.color.prepare.start', context: { documentId: original.id, mode: settings.mode, time: options.time ?? { kind: 'static' } } });
  const content = { ...structuredClone(original), id: createImageEditIdV3('color-original'),
    geometry: { ...original.geometry, orientation: { rotate: 0 as const, mirrored: false }, crop: null } };
  const parent = { ...original, color };
  let appearance: Awaited<ReturnType<typeof prepareSmartContentAppearanceV3>> | undefined;
  let originalAppearance: typeof appearance;
  try {
    appearance = await prepareSmartContentAppearanceV3(content, parent, bus.getResourceByteSizes(), signal, settings.mode === 'assign' ? (done, total) => options.onProgress?.(done, total * 2) : options.onProgress,
      settings.mode === 'assign' ? tile => createFloat32PremultipliedRgbaTile(tile.width, tile.height, 'linear-light',
        assignRgbProfilePixels(tile.data, original.color.transferFunction, color.transferFunction,
          original.color.hdrMetadata?.referenceWhiteNits ?? 203, color.hdrMetadata?.referenceWhiteNits ?? 203),
        color.workingSpace, color.transferFunction, color.hdrMetadata?.referenceWhiteNits ?? 203) : undefined);
    signal.throwIfAborted();
    if (bus.getSnapshot().document !== original) throw new Error('原图片已改变，请重新读取颜色后重试');
    let editableContent = content;
    if (settings.mode === 'assign') {
      // Assigned pixels are authoritative in the new contract. Rebuilding a smart cache
      // must not silently reinterpret the old document with a conversion instead.
      originalAppearance = await prepareSmartContentAppearanceV3(content, parent,
        bus.getResourceByteSizes(), signal, (done, total) => options.onProgress?.(total + done, total * 2));
      const assigned = { ...createImageEditRasterLayerV3(createImageEditIdV3('assigned-pixels'), '指定配置后的像素'),
        source: appearance.source, tiles: appearance.tiles };
      editableContent = { ...content, id: createImageEditIdV3('assigned-content'), color, layers: [{ ...createImageEditLayerCommonV3(createImageEditIdV3('assigned-original'), '指定前的可编辑原稿'),
        visible: false, type: 'smart', source: originalAppearance.source, tiles: originalAppearance.tiles,
        content: { id: createImageEditIdV3('assigned-original-content'), origin: null, document: content,
          width: originalAppearance.width, height: originalAppearance.height } }, assigned] };
      Object.assign(appearance.bytes, originalAppearance.bytes);
      signal.throwIfAborted();
      if (bus.getSnapshot().document !== original) throw new Error('原图片已改变，请重新读取颜色后重试');
    }
    // The editable original stays inside the smart object; only its float appearance is converted.
    // This preserves all filter reference grids, mask semantics, text and HDR headroom.
    const commands: ImageEditLeafCommandV3[] = [];
    for (const layer of [...original.layers].reverse()) {
      if (layer.locked) commands.push({ type: 'layer.update-common', commandId: createImageEditIdV3('color-unlock'), expectedRevision: original.revision, layerId: layer.id, patch: { locked: false } });
      commands.push({ type: 'layer.delete', commandId: createImageEditIdV3('color-remove'), expectedRevision: original.revision, layerId: layer.id });
    }
    commands.push({ type: 'document.set-color', commandId: createImageEditIdV3('color-mode'), expectedRevision: original.revision, color });
    commands.push({ type: 'layer.add', commandId: createImageEditIdV3('color-content'), expectedRevision: original.revision, index: 0, parentId: null,
      layer: { ...createImageEditLayerCommonV3(createImageEditIdV3('color-layer'), settings.mode === 'assign' ? '指定颜色配置后的原稿' : '转换颜色后的原稿'),
        type: 'smart', source: appearance.source, tiles: appearance.tiles,
        content: { id: createImageEditIdV3('color-content'), origin: null, document: editableContent, width: appearance.width, height: appearance.height } } });
    const command = prepareImageEditCommandV3(original, { type: 'document.atomic', commandId: createImageEditIdV3('color-change'), expectedRevision: original.revision, commands }, new Map(Object.entries(appearance.bytes)));
    if (command.type !== 'document.atomic') throw new Error('颜色调整需要原子命令');
    const lease = appearance, originalLease = originalAppearance;
    const release = async () => { await lease.release(); await originalLease?.release(); };
    const abandon = retainSmartContentResourcesV3(bus, release);
    const ids = new Set([command.commandId, ...command.commands.map(child => child.commandId)]);
    logger.info('颜色调整已准备', { event: 'image_edit.color.prepare.completed', context: { documentId: original.id, mode: settings.mode } });
    return { commands: [command], release: async () => {
      const history = bus.getPersistenceSnapshot().history;
      const published = [...history.undo, ...history.redo].some(entry => ids.has(entry.forward.commandId)
        || (entry.forward.type === 'document.atomic' && entry.forward.commands.some(child => ids.has(child.commandId))));
      if (!published) await abandon();
    } };
  } catch (error) {
    await appearance?.release();
    await originalAppearance?.release();
    logger.warn('颜色调整未应用', { event: 'image_edit.color.prepare.failed', error });
    throw error;
  }
}
