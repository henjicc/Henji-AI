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
          handler(files, event.target)
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
      // 放下在捕获阶段收：落点区接住文件后会拦冒泡，冒泡阶段收不到就一直停在“正在拖”
      document.addEventListener('drop', dropListener, true)
      document.addEventListener('dragend', dropListener, true)
      return () => {
        document.removeEventListener('dragenter', enterListener)
        document.removeEventListener('dragleave', leaveListener)
        document.removeEventListener('drop', dropListener, true)
        document.removeEventListener('dragend', dropListener, true)
      }
    },
  }
}
