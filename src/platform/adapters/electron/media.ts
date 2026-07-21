import { inferMimeFromPath } from '@/utils/mime'
import type { MediaPlatform } from '@/platform/contracts/media'

const MEDIA_SCHEME = 'henji-media'

function isDisplayUrl(source: string): boolean {
  return /^(https?:|data:|blob:|file:|asset:|tauri:|henji-media:)/i.test(source)
}

function toMediaUrl(localPath: string): string {
  return `${MEDIA_SCHEME}://local/${encodeURIComponent(localPath)}`
}

function getNative(): NonNullable<typeof window.henjiNative> {
  const native = window.henjiNative
  if (!native) {
    throw new Error('[platform:media] henjiNative is not available')
  }
  return native
}

async function readFileBytes(localPath: string): Promise<Uint8Array> {
  const native = getNative()
  return await native.fs.readFile(localPath)
}

async function readBlob(localPath: string, mimeHint?: string): Promise<Blob> {
  const bytes = await readFileBytes(localPath)
  const normalized = new Uint8Array(bytes.byteLength)
  normalized.set(bytes)
  return new Blob([normalized], { type: mimeHint || inferMimeFromPath(localPath) })
}

export function createElectronMedia(): MediaPlatform {
  return {
    async allowRoot(rootPath: string): Promise<void> {
      await getNative().media.allowRoot(rootPath)
    },
    async isPathAllowed(targetPath: string): Promise<boolean> {
      return await getNative().media.isPathAllowed(targetPath)
    },
    toDisplaySrc(localPath: string) {
      return isDisplayUrl(localPath) ? localPath : toMediaUrl(localPath)
    },
    async readLocalFileAsBlob(localPath: string, mimeHint?: string) {
      return await readBlob(localPath, mimeHint)
    },
    async readLocalFileAsDataUrl(localPath: string, mimeHint?: string) {
      const blob = await readBlob(localPath, mimeHint)
      return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onloadend = () => resolve(reader.result as string)
        reader.onerror = (error) => reject(error)
        reader.readAsDataURL(blob)
      })
    },
    getPathForFile(file: File): string {
      return getNative().media.getPathForFile(file)
    },
    async getBundledResourcePath(relativePath: string): Promise<string | null> {
      return await getNative().media.getBundledResourcePath(relativePath)
    },
  }
}
