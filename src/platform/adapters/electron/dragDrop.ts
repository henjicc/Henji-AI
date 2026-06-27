import type { DragDropPlatform } from '@/platform/contracts/dragDrop'

const DOMAIN = 'dragDrop'

function getNativeDrag(): NonNullable<typeof window.henjiNative>['drag'] {
  const native = window.henjiNative
  if (!native?.drag) {
    throw new Error(`[platform:${DOMAIN}] henjiNative.drag is not available`)
  }
  return native.drag
}

function extractDroppedFiles(event: DragEvent): File[] {
  const fileList = event.dataTransfer?.files
  return fileList ? Array.from(fileList) : []
}

export function createElectronDragDrop(): DragDropPlatform {
  return {
    startNativeFileDrag: (filePath, iconPath) => {
      const nativeDrag = getNativeDrag()
      nativeDrag.startNativeFileDragImmediate(filePath, iconPath)
      return Promise.resolve()
    },

    onFilesDropped: (handler) => {
      const listener = (event: DragEvent): void => {
        const files = extractDroppedFiles(event)
        if (files.length > 0) {
          handler(files)
        }
      }
      document.addEventListener('drop', listener)
      return () => {
        document.removeEventListener('drop', listener)
      }
    },

    onDragStateChange: (handler) => {
      let depth = 0
      const enterListener = (event: DragEvent): void => {
        if (event.dataTransfer?.types.includes('Files')) {
          depth += 1
          handler(true)
        }
      }
      const leaveListener = (event: DragEvent): void => {
        if (event.dataTransfer?.types.includes('Files')) {
          depth = Math.max(0, depth - 1)
          if (depth === 0) handler(false)
        }
      }
      const dropListener = (): void => {
        depth = 0
        handler(false)
      }
      document.addEventListener('dragenter', enterListener)
      document.addEventListener('dragleave', leaveListener)
      document.addEventListener('drop', dropListener)
      return () => {
        document.removeEventListener('dragenter', enterListener)
        document.removeEventListener('dragleave', leaveListener)
        document.removeEventListener('drop', dropListener)
      }
    },
  }
}
