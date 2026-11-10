import { inferMimeFromPath as inferMimeFromPathShared } from './mime'

export { isDesktop } from './save/environment'
export { saveImageFromUrl, saveVideoFromUrl, saveAudioFromUrl } from './save/saveFromUrl'
export { downloadAudioFile, downloadMediaFile, quickDownloadMediaFile } from './save/downloadDialogs'
export { resolveFilePath } from './save/resolveFilePath'
export { fileToDataUrl } from './save/fileUrls'
export {
  saveUploadAudio,
  saveUploadVideo,
  saveBase64ToUploads,
  saveBytesToUploads,
  deleteUploads,
  dataUrlToBlob,
  ensureCompressedJpegBytesWithPica,
} from './save/uploads'

// Backward-compatible API: some call sites import this helper from '@/utils/save'.
export function inferMimeFromPath(p: string): string {
  return inferMimeFromPathShared(p)
}
