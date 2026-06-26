import { PlatformNotImplementedError } from '@/platform/types'
import type { ImagePlatform } from '@/platform/contracts/image'

const DOMAIN = 'image'

export function createElectronImage(): ImagePlatform {
  return {
    splitImage: () => {
      throw new PlatformNotImplementedError(DOMAIN, 'splitImage')
    },
    splitImageSource: () => {
      throw new PlatformNotImplementedError(DOMAIN, 'splitImageSource')
    },
    prepareNodeImageSource: () => {
      throw new PlatformNotImplementedError(DOMAIN, 'prepareNodeImageSource')
    },
    prepareNodeImageBinary: () => {
      throw new PlatformNotImplementedError(DOMAIN, 'prepareNodeImageBinary')
    },
    cropImageSource: () => {
      throw new PlatformNotImplementedError(DOMAIN, 'cropImageSource')
    },
    mergeStoryboardImages: () => {
      throw new PlatformNotImplementedError(DOMAIN, 'mergeStoryboardImages')
    },
    readStoryboardImageMetadata: () => {
      throw new PlatformNotImplementedError(DOMAIN, 'readStoryboardImageMetadata')
    },
    embedStoryboardImageMetadata: () => {
      throw new PlatformNotImplementedError(DOMAIN, 'embedStoryboardImageMetadata')
    },
    loadImage: () => {
      throw new PlatformNotImplementedError(DOMAIN, 'loadImage')
    },
    persistImageSource: () => {
      throw new PlatformNotImplementedError(DOMAIN, 'persistImageSource')
    },
    persistImageBinary: () => {
      throw new PlatformNotImplementedError(DOMAIN, 'persistImageBinary')
    },
    saveImageSourceToDownloads: () => {
      throw new PlatformNotImplementedError(DOMAIN, 'saveImageSourceToDownloads')
    },
    saveImageSourceToPath: () => {
      throw new PlatformNotImplementedError(DOMAIN, 'saveImageSourceToPath')
    },
    saveImageSourceToDirectory: () => {
      throw new PlatformNotImplementedError(DOMAIN, 'saveImageSourceToDirectory')
    },
    saveImageSourceToAppDebugDir: () => {
      throw new PlatformNotImplementedError(DOMAIN, 'saveImageSourceToAppDebugDir')
    },
    readImageInfo: () => {
      throw new PlatformNotImplementedError(DOMAIN, 'readImageInfo')
    },
  }
}
