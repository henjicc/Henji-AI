import type { AiRuntimePlatform } from './aiRuntime'
import type { LlmRuntimePlatform } from './llmRuntime'
import type { DbPlatform } from './db'
import type { CanvasProjectsPlatform } from './canvasProjects'
import type { CustomModelsPlatform } from './customModels'
import type { SystemPlatform } from './system'
import type { MediaPlatform } from './media'
import type { ImagePlatform } from './image'
import type { ImageEditorV3Platform } from './imageEditorV3'
import type { VideoPlatform } from './video'
import type { ClipboardPlatform } from './clipboard'
import type { DragDropPlatform } from './dragDrop'
import type { ProjectCoversPlatform } from './projectCovers'
import type { ProjectPackagePlatform } from './projectPackage'
import type { StoryboardProjectsPlatform } from './storyboardProjects'
import type { CameraStageProjectsPlatform } from './cameraStageProjects'
import type { CameraStageRenderPlatform } from './cameraStageRender'
import type { WindowPlatform } from './window'
import type { LoggingPlatform } from './logging'
import type { UpdaterPlatform } from './updater'
import type { AssetLibraryPlatform } from './assetLibrary'
import type { AssistantPlatform } from './assistant'

export interface PlatformRuntime {
  aiRuntime: AiRuntimePlatform
  llmRuntime: LlmRuntimePlatform
  db: DbPlatform
  canvasProjects: CanvasProjectsPlatform
  customModels: CustomModelsPlatform
  system: SystemPlatform
  media: MediaPlatform
  image: ImagePlatform
  imageEditorV3: ImageEditorV3Platform
  video: VideoPlatform
  clipboard: ClipboardPlatform
  dragDrop: DragDropPlatform
  projectCovers: ProjectCoversPlatform
  projectPackage: ProjectPackagePlatform
  storyboardProjects: StoryboardProjectsPlatform
  cameraStageProjects: CameraStageProjectsPlatform
  cameraStageRender: CameraStageRenderPlatform
  window: WindowPlatform
  logging: LoggingPlatform
  updater: UpdaterPlatform
  assetLibrary: AssetLibraryPlatform
  assistant: AssistantPlatform
}

export type {
  AiRuntimePlatform,
  LlmRuntimePlatform,
  DbPlatform,
  CanvasProjectsPlatform,
  CustomModelsPlatform,
  SystemPlatform,
  MediaPlatform,
  ImagePlatform,
  ImageEditorV3Platform,
  VideoPlatform,
  ClipboardPlatform,
  DragDropPlatform,
  ProjectCoversPlatform,
  ProjectPackagePlatform,
  StoryboardProjectsPlatform,
  CameraStageProjectsPlatform,
  CameraStageRenderPlatform,
  WindowPlatform,
  LoggingPlatform,
  UpdaterPlatform,
  AssetLibraryPlatform,
  AssistantPlatform,
}
export * from './aiRuntime'
export * from './llmRuntime'
export * from './db'
export * from './canvasProjects'
export * from './customModels'
export * from './system'
export * from './media'
export * from './image'
export * from './imageEditorV3'
export * from './video'
export * from './clipboard'
export * from './dragDrop'
export * from './projectCovers'
export * from './projectPackage'
export * from './storyboardProjects'
export * from './cameraStageProjects'
export * from './cameraStageRender'
export * from './window'
export * from './logging'
export * from './updater'
export * from './assetLibrary'
export * from './assistant'
