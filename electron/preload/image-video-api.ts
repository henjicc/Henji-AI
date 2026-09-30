import { ipcRenderer } from 'electron'
import type {
  HenjiImageApi,
  HenjiVideoApi,
  HenjiVideoFrameExportProgress,
} from './api'

type NativeInvoke = <T>(channel: string, payload?: unknown) => Promise<T>

export function createImageVideoApis(nativeInvoke: NativeInvoke): {
  imageApi: HenjiImageApi
  videoApi: HenjiVideoApi
} {
  const imageApi: HenjiImageApi = {
    splitImage: (imageBase64, rows, cols, lineThickness) =>
      nativeInvoke('image:splitImage', { imageBase64, rows, cols, lineThickness }),
    splitImageSource: (source, rows, cols, lineThickness) =>
      nativeInvoke('image:splitImageSource', { source, rows, cols, lineThickness }),
    prepareNodeImageSource: (source, maxPreviewDimension) =>
      nativeInvoke('image:prepareNodeImageSource', { source, maxPreviewDimension }),
    prepareNodeImageBinary: (bytes, extension, maxPreviewDimension) =>
      nativeInvoke('image:prepareNodeImageBinary', { bytes, extension, maxPreviewDimension }),
    cropImageSource: (payload) => nativeInvoke('image:cropImageSource', payload),
    prepareLocalRedraw: (payload) => nativeInvoke('image:prepareLocalRedraw', payload),
    composeLocalRedraw: (payload) => nativeInvoke('image:composeLocalRedraw', payload),
    mergeStoryboardImages: (payload) => nativeInvoke('image:mergeStoryboardImages', payload),
    readStoryboardImageMetadata: (source) => nativeInvoke('image:readStoryboardImageMetadata', { source }),
    embedStoryboardImageMetadata: (source, metadata) => nativeInvoke('image:embedStoryboardImageMetadata', { source, metadata }),
    readPanoramaImageMetadata: (source) => nativeInvoke('image:readPanoramaImageMetadata', { source }),
    embedPanoramaImageMetadata: (source) => nativeInvoke('image:embedPanoramaImageMetadata', { source }),
    loadImage: (filePath) => nativeInvoke('image:loadImage', { filePath }),
    persistImageSource: (source) => nativeInvoke('image:persistImageSource', { source }),
    persistImageSourceTracked: (source) => nativeInvoke('image:persistImageSourceTracked', { source }),
    persistImageBinary: (bytes, extension) => nativeInvoke('image:persistImageBinary', { bytes, extension }),
    saveImageSourceToDownloads: (source, suggestedFileName) => nativeInvoke('image:saveImageSourceToDownloads', { source, suggestedFileName }),
    saveImageSourceToPath: (source, targetPath) => nativeInvoke('image:saveImageSourceToPath', { source, targetPath }),
    savePanoramaImageSourceToPath: (source, targetPath) => nativeInvoke('image:savePanoramaImageSourceToPath', { source, targetPath }),
    saveImageSourceToDirectory: (source, targetDir, suggestedFileName) => nativeInvoke('image:saveImageSourceToDirectory', { source, targetDir, suggestedFileName }),
    savePanoramaImageSourceToDirectory: (source, targetDir, suggestedFileName) => nativeInvoke('image:savePanoramaImageSourceToDirectory', { source, targetDir, suggestedFileName }),
    saveImageSourceToAppDebugDir: (source, category, suggestedFileName) => nativeInvoke('image:saveImageSourceToAppDebugDir', { source, category, suggestedFileName }),
    readImageInfo: (source) => nativeInvoke('image:readImageInfo', { source }),
    probeDiffusionFallback: () => nativeInvoke('image:probeDiffusionFallback'),
    renderDiffusionFallback: (request) => nativeInvoke('image:renderDiffusionFallback', request),
    compressImageSource: (payload) => nativeInvoke('image:compressImageSource', payload),
    generateThumbnailBytes: (payload) => nativeInvoke('image:generateThumbnailBytes', payload),
    composeLayerStack: (payload) => nativeInvoke('image:composeLayerStack', payload),
    releaseLayerStackResources: (filePaths) => nativeInvoke('image:releaseLayerStackResources', { filePaths }),
    releaseManagedGenerationMedia: (filePaths) => nativeInvoke('image:releaseManagedGenerationMedia', { filePaths }),
  }

  const videoApi: HenjiVideoApi = {
    readVideoInfo: (source) => nativeInvoke('video:readVideoInfo', { source }),
    trimVideoSource: (payload) => nativeInvoke('video:trimVideoSource', payload),
    compressVideoToFit: (payload) => nativeInvoke('video:compressVideoToFit', payload),
    generateThumbnail: (payload) => nativeInvoke('video:generateThumbnail', payload),
    generateThumbnailBytes: (payload) => nativeInvoke('video:generateThumbnailBytes', payload),
    startFrameExport: (payload) => nativeInvoke('video:startFrameExport', payload),
    appendFrameExport: (payload) => nativeInvoke('video:appendFrameExport', payload),
    finishFrameExport: (payload) => nativeInvoke('video:finishFrameExport', payload),
    cancelFrameExport: (sessionId) => nativeInvoke('video:cancelFrameExport', { sessionId }),
    onFrameExportProgress: (handler) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: HenjiVideoFrameExportProgress): void => {
        handler(payload)
      }
      ipcRenderer.on('video:frameExportProgress', listener)
      return () => {
        ipcRenderer.removeListener('video:frameExportProgress', listener)
      }
    },
  }
  return { imageApi, videoApi }
}
