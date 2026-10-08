import type { ImageEditorV3Platform } from '../../contracts/imageEditorV3'

const DOMAIN = 'imageEditorV3'

function getNativeImageEditorV3(): ImageEditorV3Platform {
  const native = window.henjiNative as { imageEditorV3?: ImageEditorV3Platform } | undefined
  if (!native?.imageEditorV3) {
    throw new Error(`[platform:${DOMAIN}] henjiNative.imageEditorV3 is not available`)
  }
  return native.imageEditorV3
}

export function createElectronImageEditorV3(): ImageEditorV3Platform {
  return {
    repairRaster: request => { const method = getNativeImageEditorV3().repairRaster; if (!method) throw new Error('图片修复不可用，请更新应用'); return method(request) },
    readRepairProgress: request => getNativeImageEditorV3().readRepairProgress?.(request) ?? Promise.resolve(null),
    pinRepairResources: request => { const method = getNativeImageEditorV3().pinRepairResources; if (!method) throw new Error('图片修复资源保护不可用'); return method(request) },
    releaseRepairResources: request => getNativeImageEditorV3().releaseRepairResources?.(request) ?? Promise.resolve(),
    listDocuments: (request) => getNativeImageEditorV3().listDocuments(request),
    loadDocument: (request) => getNativeImageEditorV3().loadDocument(request),
    saveDocument: (request) => getNativeImageEditorV3().saveDocument(request),
    forkDocument: (request) => getNativeImageEditorV3().forkDocument(request),
    deleteDocumentIfRevision: (request) => (
      getNativeImageEditorV3().deleteDocumentIfRevision(request)
    ),
    importColorLut: (request) => {
      const method = getNativeImageEditorV3().importColorLut
      if (!method) throw new Error('颜色查找表导入不可用')
      return method(request)
    },
    importSource: (request) => getNativeImageEditorV3().importSource(request),
    ingestSource: (request) => getNativeImageEditorV3().ingestSource(request),
    readSourceMetadata: (request) => getNativeImageEditorV3().readSourceMetadata(request),
    describeSourcePyramid: (request) => getNativeImageEditorV3().describeSourcePyramid(request),
    prewarmSourcePyramid: (request) => getNativeImageEditorV3().prewarmSourcePyramid(request),
    readFastProxy: (request) => getNativeImageEditorV3().readFastProxy(request),
    readSourceTile: (request) => getNativeImageEditorV3().readSourceTile(request),
    readSourceTiles: (request) => {
      const read = getNativeImageEditorV3().readSourceTiles
      if (!read) throw new Error('[platform:imageEditorV3] readSourceTiles is not available')
      return read(request)
    },
    persistBrushTiles: (request) => getNativeImageEditorV3().persistBrushTiles(request),
    readBrushTiles: (request) => getNativeImageEditorV3().readBrushTiles(request),
    openImageDocument: (request) => getNativeImageEditorV3().openImageDocument(request),
    describeImageDocument: (request) => getNativeImageEditorV3().describeImageDocument(request),
    createImageDocument: (request) => getNativeImageEditorV3().createImageDocument(request),
    commitImageDocument: (request) => getNativeImageEditorV3().commitImageDocument(request),
    prepareCanvasLayers: (request) => getNativeImageEditorV3().prepareCanvasLayers(request),
    commitCanvasLayers: (request) => getNativeImageEditorV3().commitCanvasLayers(request),
    startRasterExport: (request) => getNativeImageEditorV3().startRasterExport(request),
    startManagedRasterExport: (request) => getNativeImageEditorV3().startManagedRasterExport(request),
    writeRasterExportTile: (request) => getNativeImageEditorV3().writeRasterExportTile(request),
    restartRasterExport: (request) => getNativeImageEditorV3().restartRasterExport(request),
    completeRasterExport: (request) => getNativeImageEditorV3().completeRasterExport(request),
    completeManagedRasterExport: (request) => getNativeImageEditorV3().completeManagedRasterExport(request),
    cancelRasterExport: (request) => getNativeImageEditorV3().cancelRasterExport(request),
    collectGarbage: (request) => getNativeImageEditorV3().collectGarbage(request),
    cancelRequest: (requestId) => getNativeImageEditorV3().cancelRequest(requestId),
  }
}
