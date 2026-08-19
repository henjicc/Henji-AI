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
import { createElectronStoryboardProjects } from './storyboardProjects'
import { createElectronCameraStageProjects } from './cameraStageProjects'
import { createElectronProjectCovers } from './projectCovers'
import { createElectronCameraStageRender } from './cameraStageRender'
import { createElectronWindow } from './window'
import { createElectronLogging } from './logging'
import { createElectronUpdater } from './updater'
import { createElectronAssetLibrary } from './assetLibrary'
import { createElectronAssistant } from './assistant'

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
    storyboardProjects: createElectronStoryboardProjects(),
    cameraStageProjects: createElectronCameraStageProjects(),
    projectCovers: createElectronProjectCovers(),
    cameraStageRender: createElectronCameraStageRender(),
    window: createElectronWindow(),
    logging: createElectronLogging(),
    updater: createElectronUpdater(),
    assetLibrary: createElectronAssetLibrary(),
    assistant: createElectronAssistant(),
  }
}
