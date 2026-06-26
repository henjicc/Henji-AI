import { invoke } from '@tauri-apps/api/core'
import type { ClipboardFileEntry, ClipboardPlatform } from '@/platform/contracts/clipboard'

export function createTauriClipboard(): ClipboardPlatform {
  return {
    readClipboardFiles: () => invoke<ClipboardFileEntry[]>('read_clipboard_files'),
    async readText() {
      const { readText } = await import('@tauri-apps/plugin-clipboard-manager')
      return await readText()
    },
    async writeImageFromPath(filePath) {
      await invoke('copy_image_to_clipboard', { filePath })
    },
    async writeImageFromSource(source) {
      await invoke('copy_image_source_to_clipboard', { source })
    },
  }
}
