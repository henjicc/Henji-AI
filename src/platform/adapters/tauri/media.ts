import { convertFileSrc } from '@tauri-apps/api/core'
import { readFile } from '@tauri-apps/plugin-fs'
import { inferMimeFromPath } from '@/utils/mime'
import type { MediaPlatform } from '@/platform/contracts/media'

export function createTauriMedia(): MediaPlatform {
  return {
    async allowRoot(): Promise<void> {
      // Tauri convertFileSrc is governed by Tauri's asset protocol scope.
    },
    toDisplaySrc(localPath: string) {
      return convertFileSrc(localPath)
    },
    async readLocalFileAsBlob(localPath: string, mimeHint?: string) {
      const bytes = await readFile(localPath)
      return new Blob([bytes], { type: mimeHint || inferMimeFromPath(localPath) })
    },
    async readLocalFileAsDataUrl(localPath: string, mimeHint?: string) {
      const blob = await this.readLocalFileAsBlob(localPath, mimeHint)
      return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onloadend = () => resolve(reader.result as string)
        reader.onerror = (error) => reject(error)
        reader.readAsDataURL(blob)
      })
    },
  }
}
