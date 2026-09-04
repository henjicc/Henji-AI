import type { HenjiAssistantApi } from './api-assistant'
import type {
  HenjiCameraStageProjectsApi,
  HenjiCameraStageRenderApi,
  HenjiCanvasProjectsApi,
  HenjiCustomModelsApi,
  HenjiDbApi,
  HenjiDiagnosticsApi,
  HenjiProjectCoversApi,
  HenjiStoryboardProjectsApi,
  HenjiWindowApi,
} from './api-projects'
import type { HenjiAiApi, HenjiLlmApi } from './api-ai'
import type { HenjiAudioApi, HenjiImageApi, HenjiVideoApi } from './api-media'
import type {
  HenjiAssetLibraryApi,
  HenjiClipboardApi,
  HenjiDialogApi,
  HenjiDragApi,
  HenjiFsApi,
  HenjiHttpApi,
  HenjiLoggingApi,
  HenjiMediaApi,
  HenjiPathsApi,
  HenjiProjectPackageApi,
  HenjiShellApi,
  HenjiUpdaterApi,
} from './api-desktop'
import type { HenjiImageEditorV3Api } from './image-editor-v3-api'

export * from './api-assistant'
export * from './api-projects'
export * from './api-ai'
export * from './api-media'
export * from './api-desktop'
export type { HenjiImageEditorV3Api } from './image-editor-v3-api'

export interface HenjiNativeApi {
  runtimeInfo: {
    uiInspectionActive: boolean
    uiInspectionReadOnly: boolean
    featureFlags: {
      imageEditorV3: boolean
    }
  }
  assistant: HenjiAssistantApi
  ai: HenjiAiApi
  llm: HenjiLlmApi
  db: HenjiDbApi
  canvasProjects: HenjiCanvasProjectsApi
  storyboardProjects: HenjiStoryboardProjectsApi
  cameraStageProjects: HenjiCameraStageProjectsApi
  projectCovers: HenjiProjectCoversApi
  cameraStageRender: HenjiCameraStageRenderApi
  customModels: HenjiCustomModelsApi
  fs: HenjiFsApi
  dialog: HenjiDialogApi
  shell: HenjiShellApi
  paths: HenjiPathsApi
  http: HenjiHttpApi
  media: HenjiMediaApi
  image: HenjiImageApi
  imageEditorV3: HenjiImageEditorV3Api
  video: HenjiVideoApi
  audio: HenjiAudioApi
  clipboard: HenjiClipboardApi
  drag: HenjiDragApi
  projectPackage: HenjiProjectPackageApi
  logging: HenjiLoggingApi
  updater: HenjiUpdaterApi
  modelscope: Record<string, never>
  window: HenjiWindowApi
  diagnostics: HenjiDiagnosticsApi
  assetLibrary: HenjiAssetLibraryApi
}

declare global {
  interface Window {
    henjiNative?: HenjiNativeApi
  }
}

export {}
