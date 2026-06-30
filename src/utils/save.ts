import { inferMimeFromPath as inferMimeFromPathShared } from './mime'

export { isDesktop, isDesktopAsync } from './save/environment'
export { saveBinary, saveImageFromUrl, saveVideoFromUrl, saveAudioFromUrl } from './save/saveFromUrl'
export { downloadAudioFile, downloadMediaFile, quickDownloadMediaFile } from './save/downloadDialogs'
export { resolveFilePath } from './save/resolveFilePath'
export { fileToBlobSrc, fileToDataUrl } from './save/fileUrls'
export { sha256Hex } from './save/hash'
export {
  saveUploadImage,
  saveUploadAudio,
  saveUploadVideo,
  saveBase64ToUploads,
  saveBytesToUploads,
  deleteUploads,
  isWithinUploadsDir,
  dataUrlToBlob,
  ensureCompressedJpegBytesWithPica,
} from './save/uploads'
export {
  readWaveformCacheForAudio,
  writeWaveformCacheForAudio,
  deleteWaveformCacheForAudio,
} from './save/waveformCache'
export { writeJsonToAppData, readJsonFromAppData } from './save/appDataJson'

// Backward-compatible API: some call sites import this helper from '@/utils/save'.
export function inferMimeFromPath(p: string): string {
  return inferMimeFromPathShared(p)
}
