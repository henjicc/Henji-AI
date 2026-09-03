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
    loadDocument: (request) => getNativeImageEditorV3().loadDocument(request),
    saveDocument: (request) => getNativeImageEditorV3().saveDocument(request),
    deleteDocumentIfRevision: (request) => (
      getNativeImageEditorV3().deleteDocumentIfRevision(request)
    ),
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
    openPackage: (request) => getNativeImageEditorV3().openPackage(request),
    relinkPackageExternalSource: (request) => (
      getNativeImageEditorV3().relinkPackageExternalSource(request)
    ),
    savePackageAs: (request) => getNativeImageEditorV3().savePackageAs(request),
    startRasterExport: (request) => getNativeImageEditorV3().startRasterExport(request),
    startManagedRasterExport: (request) => getNativeImageEditorV3().startManagedRasterExport(request),
    writeRasterExportTile: (request) => getNativeImageEditorV3().writeRasterExportTile(request),
    completeRasterExport: (request) => getNativeImageEditorV3().completeRasterExport(request),
    completeManagedRasterExport: (request) => getNativeImageEditorV3().completeManagedRasterExport(request),
    cancelRasterExport: (request) => getNativeImageEditorV3().cancelRasterExport(request),
    collectGarbage: (request) => getNativeImageEditorV3().collectGarbage(request),
    cancelRequest: (requestId) => getNativeImageEditorV3().cancelRequest(requestId),
  }
}
