import type { AiRuntimePlatform } from './aiRuntime'
import type { LlmRuntimePlatform } from './llmRuntime'
import type { GenerationHistoryPlatform, PresetsPlatform, SettingsPlatform } from './localRecords'
import type { CustomModelsPlatform } from './customModels'
import type { SystemPlatform } from './system'
import type { MediaPlatform } from './media'
import type { ImagePlatform } from './image'
import type { ImageEditorV3Platform } from './imageEditorV3'
import type { VideoPlatform } from './video'
import type { ClipboardPlatform } from './clipboard'
import type { DragDropPlatform } from './dragDrop'
import type { CameraStageRenderPlatform } from './cameraStageRender'
import type { WindowPlatform } from './window'
import type { LoggingPlatform } from './logging'
import type { UpdaterPlatform } from './updater'
import type { AssetLibraryPlatform } from './assetLibrary'
import type { AssistantPlatform } from './assistant'
import type { EmbeddedAgentPlatform } from '@/core/assistant/embeddedAgent'
import type { ApplicationHostPlatform, McpPlatform } from '@/core/application-control/localHostContracts'
import type { AudioEditPlatform } from './audioEdit'
import type { VideoFramesPlatform } from './videoFrames'
import type { VideoDecoderPlatform } from './videoDecoder'
import type { DocumentsPlatform } from './documents'
import type { WorkRootPlatform } from './workRoot'

export interface PlatformRuntime {
  embeddedAgent: EmbeddedAgentPlatform
  applicationControl: ApplicationHostPlatform
  mcp: McpPlatform
  aiRuntime: AiRuntimePlatform
  llmRuntime: LlmRuntimePlatform
  generationHistory: GenerationHistoryPlatform
  presets: PresetsPlatform
  settings: SettingsPlatform
  customModels: CustomModelsPlatform
  system: SystemPlatform
  media: MediaPlatform
  image: ImagePlatform
  imageEditorV3: ImageEditorV3Platform
  video: VideoPlatform
  clipboard: ClipboardPlatform
  dragDrop: DragDropPlatform
  cameraStageRender: CameraStageRenderPlatform
  window: WindowPlatform
  logging: LoggingPlatform
  updater: UpdaterPlatform
  assetLibrary: AssetLibraryPlatform
  assistant: AssistantPlatform
  audioEdit: AudioEditPlatform
  videoFrames: VideoFramesPlatform
  videoDecoder: VideoDecoderPlatform
  documents: DocumentsPlatform
  workRoot: WorkRootPlatform
}

export type {
  AiRuntimePlatform,
  LlmRuntimePlatform,
  GenerationHistoryPlatform,
  PresetsPlatform,
  SettingsPlatform,
  CustomModelsPlatform,
  SystemPlatform,
  MediaPlatform,
  ImagePlatform,
  ImageEditorV3Platform,
  VideoPlatform,
  ClipboardPlatform,
  DragDropPlatform,
  CameraStageRenderPlatform,
  WindowPlatform,
  LoggingPlatform,
  UpdaterPlatform,
  AssetLibraryPlatform,
  AssistantPlatform,
  AudioEditPlatform,
  VideoFramesPlatform,
  VideoDecoderPlatform,
  DocumentsPlatform,
}
export * from './aiRuntime'
export * from './llmRuntime'
export * from './localRecords'
export * from './customModels'
export * from './system'
export * from './media'
export * from './image'
export * from './imageEditorV3'
export * from './video'
export * from './clipboard'
export * from './dragDrop'
export * from './cameraStageRender'
export * from './window'
export * from './logging'
export * from './updater'
export * from './assetLibrary'
export * from './assistant'
export * from './audioEdit'
export * from './documents'
export * from './workRoot'
