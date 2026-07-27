import type { ClipboardPlatform } from '@/platform/contracts/clipboard'

const DOMAIN = 'clipboard'

function getNativeClipboard(): NonNullable<typeof window.henjiNative>['clipboard'] {
  const native = window.henjiNative
  if (!native?.clipboard) {
    throw new Error(`[platform:${DOMAIN}] henjiNative.clipboard is not available`)
  }
  return native.clipboard
}

export function createElectronClipboard(): ClipboardPlatform {
  return {
    readClipboardFiles: () => getNativeClipboard().readClipboardFiles(),
    readText: () => getNativeClipboard().readText(),
    readImage: () => getNativeClipboard().readImage(),
    writeImageFromPath: (filePath) => getNativeClipboard().writeImageFromPath(filePath),
    writeImageFromSource: (source) => getNativeClipboard().writeImageFromSource(source),
  }
}
