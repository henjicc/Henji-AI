import type { PlatformRuntime } from '@/platform/contracts'
import { createElectronAiRuntime } from './aiRuntime'
import { createElectronLlmRuntime } from './llmRuntime'
import { createElectronDb } from './db'
import { createElectronCanvasProjects } from './canvasProjects'
import { createElectronCustomModels } from './customModels'
import { createElectronKeystore } from './keystore'
import { createElectronSystem } from './system'
import { createElectronMedia } from './media'
import { createElectronImage } from './image'
import { createElectronVideo } from './video'
import { createElectronClipboard } from './clipboard'
import { createElectronDragDrop } from './dragDrop'
import { createElectronProjectPackage } from './projectPackage'
import { createElectronWindow } from './window'
import { createElectronLogging } from './logging'
import { createElectronUpdater } from './updater'

export function createElectronPlatform(): PlatformRuntime {
  return {
    aiRuntime: createElectronAiRuntime(),
    llmRuntime: createElectronLlmRuntime(),
    db: createElectronDb(),
    canvasProjects: createElectronCanvasProjects(),
    customModels: createElectronCustomModels(),
    keystore: createElectronKeystore(),
    system: createElectronSystem(),
    media: createElectronMedia(),
    image: createElectronImage(),
    video: createElectronVideo(),
    clipboard: createElectronClipboard(),
    dragDrop: createElectronDragDrop(),
    projectPackage: createElectronProjectPackage(),
    window: createElectronWindow(),
    logging: createElectronLogging(),
    updater: createElectronUpdater(),
  }
}
