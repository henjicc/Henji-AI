import { createElectronApplicationControl } from './applicationControl'
import type { PlatformRuntime } from '@/platform/contracts'
import { createElectronAiRuntime } from './aiRuntime'
import { createElectronLlmRuntime } from './llmRuntime'
import { createElectronGenerationHistory, createElectronPresets, createElectronSettings } from './localRecords'
import { createElectronCustomModels } from './customModels'
import { createElectronSystem } from './system'
import { createElectronMedia } from './media'
import { createElectronImage } from './image'
import { createElectronImageEditorV3 } from './imageEditorV3'
import { createElectronVideo } from './video'
import { createElectronClipboard } from './clipboard'
import { createElectronDragDrop } from './dragDrop'
import { createElectronCameraStageRender } from './cameraStageRender'
import { createElectronWindow } from './window'
import { createElectronLogging } from './logging'
import { createElectronUpdater } from './updater'
import { createElectronAssetLibrary } from './assetLibrary'
import { createElectronAssistant } from './assistant'
import { createElectronEmbeddedAgent } from './embeddedAgent'
import { createElectronMcp } from './mcp'
import { createElectronAudioEdit } from './audioEdit'
import { createElectronVideoFrames } from './videoFrames'
import { createElectronVideoDecoder } from './videoDecoder'
import { createElectronDocuments } from './documents'
import { createElectronWorkRoot } from './workRoot'
import { createElectronLocalModels } from './localModels'
import { createElectronSmartRegions } from './smartRegions'
import { createElectronTracking } from './tracking'
import { createElectronSceneDetection } from './sceneDetection'

export function createElectronPlatform(): PlatformRuntime {
  return {
    embeddedAgent: createElectronEmbeddedAgent(),
    mcp: createElectronMcp(),
    applicationControl: createElectronApplicationControl(),
    aiRuntime: createElectronAiRuntime(),
    llmRuntime: createElectronLlmRuntime(),
    generationHistory: createElectronGenerationHistory(),
    presets: createElectronPresets(),
    settings: createElectronSettings(),
    customModels: createElectronCustomModels(),
    system: createElectronSystem(),
    media: createElectronMedia(),
    image: createElectronImage(),
    imageEditorV3: createElectronImageEditorV3(),
    video: createElectronVideo(),
    clipboard: createElectronClipboard(),
    dragDrop: createElectronDragDrop(),
    cameraStageRender: createElectronCameraStageRender(),
    window: createElectronWindow(),
    logging: createElectronLogging(),
    updater: createElectronUpdater(),
    assetLibrary: createElectronAssetLibrary(),
    assistant: createElectronAssistant(),
    audioEdit: createElectronAudioEdit(),
    videoFrames: createElectronVideoFrames(),
    videoDecoder: createElectronVideoDecoder(),
    documents: createElectronDocuments(),
    workRoot: createElectronWorkRoot(),
    localModels: createElectronLocalModels(),
    smartRegions: createElectronSmartRegions(),
    tracking: createElectronTracking(),
    sceneDetection: createElectronSceneDetection(),
  }
}
