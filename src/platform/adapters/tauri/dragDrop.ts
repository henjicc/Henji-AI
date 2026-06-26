import { listen } from '@tauri-apps/api/event'
import { readFile } from '@tauri-apps/plugin-fs'
import { inferMimeFromPath } from '@/utils/mime'
import { createLogger } from '@/core/logging'
import type { DragDropPlatform, DragDropFileHandler, DragStateHandler } from '@/platform/contracts/dragDrop'

const logger = createLogger('platform.adapters.tauri.dragDrop')

type DragPosition = { x: number; y: number }
type DragDropPayload = { paths: string[]; position: DragPosition }

export function createTauriDragDrop(): DragDropPlatform {
  return {
    async startNativeFileDrag(filePath, iconPath) {
      const { startDrag } = await import('@crabnebula/tauri-plugin-drag')
      await startDrag({ item: [filePath], icon: iconPath || filePath })
    },

    onDragStateChange(handler: DragStateHandler) {
      const unlisteners: Array<Promise<() => void>> = []
      unlisteners.push(listen('tauri://drag-enter', () => handler(true)))
      unlisteners.push(listen('tauri://drag-leave', () => handler(false)))
      return () => {
        unlisteners.forEach((p) => p.then((unlisten) => unlisten()))
      }
    },

    onFilesDropped(handler: DragDropFileHandler) {
      let disposed = false
      const unlistenPromise = listen<DragDropPayload>('tauri://drag-drop', async (event) => {
        const paths = event.payload.paths
        if (!paths || paths.length === 0) return

        const files: File[] = []
        for (const path of paths) {
          try {
            const bytes = await readFile(path)
            const mime = inferMimeFromPath(path)
            const name = path.split(/[\\/]/).pop() || 'unknown'
            files.push(new File([bytes], name, { type: mime }))
          } catch (error) {
            logger.error('Failed to read dropped file:', { data: [path, error] })
          }
        }
        if (files.length > 0 && !disposed) {
          handler(files)
        }
      })

      return () => {
        disposed = true
        unlistenPromise.then((unlisten) => unlisten())
      }
    },
  }
}
