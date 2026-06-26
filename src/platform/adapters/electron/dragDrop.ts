import { PlatformNotImplementedError } from '@/platform/types'
import type { DragDropPlatform } from '@/platform/contracts/dragDrop'

const DOMAIN = 'dragDrop'

export function createElectronDragDrop(): DragDropPlatform {
  return {
    startNativeFileDrag: () => {
      throw new PlatformNotImplementedError(DOMAIN, 'startNativeFileDrag')
    },
    onFilesDropped: () => {
      return () => {}
    },
    onDragStateChange: () => {
      return () => {}
    },
  }
}
