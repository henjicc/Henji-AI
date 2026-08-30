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
    importSource: (request) => getNativeImageEditorV3().importSource(request),
    ingestSource: (request) => getNativeImageEditorV3().ingestSource(request),
    readSourceMetadata: (request) => getNativeImageEditorV3().readSourceMetadata(request),
    describeSourcePyramid: (request) => getNativeImageEditorV3().describeSourcePyramid(request),
    readFastProxy: (request) => getNativeImageEditorV3().readFastProxy(request),
    readSourceTile: (request) => getNativeImageEditorV3().readSourceTile(request),
    openPackage: (request) => getNativeImageEditorV3().openPackage(request),
    savePackageAs: (request) => getNativeImageEditorV3().savePackageAs(request),
    startRasterExport: (request) => getNativeImageEditorV3().startRasterExport(request),
    writeRasterExportTile: (request) => getNativeImageEditorV3().writeRasterExportTile(request),
    completeRasterExport: (request) => getNativeImageEditorV3().completeRasterExport(request),
    cancelRasterExport: (request) => getNativeImageEditorV3().cancelRasterExport(request),
    collectGarbage: (request) => getNativeImageEditorV3().collectGarbage(request),
    cancelRequest: (requestId) => getNativeImageEditorV3().cancelRequest(requestId),
  }
}
