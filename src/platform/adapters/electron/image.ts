import type { ImagePlatform } from '@/platform/contracts/image'

const DOMAIN = 'image'

function getNativeImage(): NonNullable<typeof window.henjiNative>['image'] {
  const native = window.henjiNative
  if (!native?.image) {
    throw new Error(`[platform:${DOMAIN}] henjiNative.image is not available`)
  }
  return native.image
}

export function createElectronImage(): ImagePlatform {
  return {
    splitImage: (imageBase64, rows, cols, lineThickness) =>
      getNativeImage().splitImage(imageBase64, rows, cols, lineThickness),
    splitImageSource: (source, rows, cols, lineThickness) =>
      getNativeImage().splitImageSource(source, rows, cols, lineThickness),
    prepareNodeImageSource: (source, maxPreviewDimension) =>
      getNativeImage().prepareNodeImageSource(source, maxPreviewDimension),
    prepareNodeImageBinary: (bytes, extension, maxPreviewDimension) =>
      getNativeImage().prepareNodeImageBinary(bytes, extension, maxPreviewDimension),
    cropImageSource: (payload) => getNativeImage().cropImageSource(payload),
    mergeStoryboardImages: (payload) => getNativeImage().mergeStoryboardImages(payload),
    readStoryboardImageMetadata: (source) => getNativeImage().readStoryboardImageMetadata(source),
    embedStoryboardImageMetadata: (source, metadata) => getNativeImage().embedStoryboardImageMetadata(source, metadata),
    readPanoramaImageMetadata: (source) => getNativeImage().readPanoramaImageMetadata(source),
    embedPanoramaImageMetadata: (source) => getNativeImage().embedPanoramaImageMetadata(source),
    loadImage: (filePath) => getNativeImage().loadImage(filePath),
    persistImageSource: (source) => getNativeImage().persistImageSource(source),
    persistImageBinary: (bytes, extension) => getNativeImage().persistImageBinary(bytes, extension),
    saveImageSourceToDownloads: (source, suggestedFileName) => getNativeImage().saveImageSourceToDownloads(source, suggestedFileName),
    saveImageSourceToPath: (source, targetPath) => getNativeImage().saveImageSourceToPath(source, targetPath),
    savePanoramaImageSourceToPath: (source, targetPath) => getNativeImage().savePanoramaImageSourceToPath(source, targetPath),
    saveImageSourceToDirectory: (source, targetDir, suggestedFileName) => getNativeImage().saveImageSourceToDirectory(source, targetDir, suggestedFileName),
    savePanoramaImageSourceToDirectory: (source, targetDir, suggestedFileName) => getNativeImage().savePanoramaImageSourceToDirectory(source, targetDir, suggestedFileName),
    saveImageSourceToAppDebugDir: (source, category, suggestedFileName) => getNativeImage().saveImageSourceToAppDebugDir(source, category, suggestedFileName),
    readImageInfo: (source) => getNativeImage().readImageInfo(source),
    probeDiffusionFallback: () => getNativeImage().probeDiffusionFallback(),
    renderDiffusionFallback: (request) => getNativeImage().renderDiffusionFallback(request),
    composeLayerStack: (payload) => getNativeImage().composeLayerStack(payload),
    cancelLayerStackComposition: (requestId) => getNativeImage().cancelLayerStackComposition(requestId),
    releaseLayerStackResources: (filePaths) => getNativeImage().releaseLayerStackResources(filePaths),
    releaseManagedGenerationMedia: (filePaths) => getNativeImage().releaseManagedGenerationMedia(filePaths),
  }
}
