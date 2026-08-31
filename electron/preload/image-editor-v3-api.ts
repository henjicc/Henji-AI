import type { ImageEditorV3Platform } from '../../src/platform/contracts/imageEditorV3'

type NativeInvoke = <T>(channel: string, payload?: unknown) => Promise<T>

/**
 * 图片编辑 V3 使用独立命名空间，避免继续膨胀旧 image IPC。所有本地路径都留在主进程；
 * 这里仅往返文档、内容寻址资源和输出引用，以及有明确尺寸上限的 ArrayBuffer。
 */
export function createImageEditorV3Api(nativeInvoke: NativeInvoke): ImageEditorV3Platform {
  return {
    loadDocument: (request) => nativeInvoke('imageEditorV3:document:load', request),
    saveDocument: (request) => nativeInvoke('imageEditorV3:document:save', request),
    importSource: (request) => nativeInvoke('imageEditorV3:source:import', request),
    ingestSource: (request) => nativeInvoke('imageEditorV3:source:ingest', request),
    readSourceMetadata: (request) => nativeInvoke('imageEditorV3:source:metadata', request),
    describeSourcePyramid: (request) => nativeInvoke('imageEditorV3:source:pyramid', request),
    prewarmSourcePyramid: (request) => nativeInvoke('imageEditorV3:source:pyramidPrewarm', request),
    readFastProxy: (request) => nativeInvoke('imageEditorV3:source:fastProxy', request),
    readSourceTile: (request) => nativeInvoke('imageEditorV3:source:tile', request),
    persistBrushTiles: (request) => nativeInvoke('imageEditorV3:brushTiles:persist', request),
    readBrushTiles: (request) => nativeInvoke('imageEditorV3:brushTiles:read', request),
    openPackage: (request) => nativeInvoke('imageEditorV3:package:open', request),
    relinkPackageExternalSource: (request) => nativeInvoke(
      'imageEditorV3:package:relinkExternalSource',
      request,
    ),
    savePackageAs: (request) => nativeInvoke('imageEditorV3:package:saveAs', request),
    startRasterExport: (request) => nativeInvoke('imageEditorV3:rasterExport:start', request),
    startManagedRasterExport: (request) => nativeInvoke('imageEditorV3:rasterExport:startManaged', request),
    writeRasterExportTile: (request) => nativeInvoke('imageEditorV3:rasterExport:writeTile', request),
    completeRasterExport: (request) => nativeInvoke('imageEditorV3:rasterExport:complete', request),
    completeManagedRasterExport: (request) => nativeInvoke('imageEditorV3:rasterExport:completeManaged', request),
    cancelRasterExport: (request) => nativeInvoke('imageEditorV3:rasterExport:cancel', request),
    collectGarbage: (request) => nativeInvoke('imageEditorV3:resource:collectGarbage', request),
    cancelRequest: (requestId) => nativeInvoke('imageEditorV3:request:cancel', { requestId }),
  }
}

export type HenjiImageEditorV3Api = ImageEditorV3Platform
