import type { VideoEditExportPlatform } from '../../contracts/videoEditExport'
function native(): VideoEditExportPlatform {
  const api = window.henjiNative?.videoEditExport as VideoEditExportPlatform | undefined
  if (!api) throw new Error('导出队列登记不可用，请重新启动应用。')
  return api
}
export function createElectronVideoEditExport(): VideoEditExportPlatform {
  return {
    capabilities: () => native().capabilities(),
    prepareCompression: (jobId, path, estimatedBytes) => native().prepareCompression(jobId, path, estimatedBytes),
    compress: request => native().compress(request),
    compressionProgress: id => native().compressionProgress(id),
    cancelCompression: id => native().cancelCompression(id),
    register: request => native().register(request), update: update => native().update(update),
    createOutput: (id, path) => native().createOutput(id, path), outputPublished: id => native().outputPublished(id),
    discardLeftovers: id => native().discardLeftovers(id), remove: ids => native().remove(ids), restore: () => native().restore(),
  }
}
