import type { AiRuntimePlatform } from './aiRuntime'
import type { LlmRuntimePlatform } from './llmRuntime'
import type { DbPlatform } from './db'
import type { KeystorePlatform } from './keystore'
import type { SystemPlatform } from './system'
import type { MediaPlatform } from './media'
import type { ImagePlatform } from './image'
import type { VideoPlatform } from './video'
import type { ClipboardPlatform } from './clipboard'
import type { DragDropPlatform } from './dragDrop'
import type { ProjectPackagePlatform } from './projectPackage'
import type { WindowPlatform } from './window'
import type { LoggingPlatform } from './logging'
import type { UpdaterPlatform } from './updater'

export interface PlatformRuntime {
  aiRuntime: AiRuntimePlatform
  llmRuntime: LlmRuntimePlatform
  db: DbPlatform
  keystore: KeystorePlatform
  system: SystemPlatform
  media: MediaPlatform
  image: ImagePlatform
  video: VideoPlatform
  clipboard: ClipboardPlatform
  dragDrop: DragDropPlatform
  projectPackage: ProjectPackagePlatform
  window: WindowPlatform
  logging: LoggingPlatform
  updater: UpdaterPlatform
}

export type {
  AiRuntimePlatform,
  LlmRuntimePlatform,
  DbPlatform,
  KeystorePlatform,
  SystemPlatform,
  MediaPlatform,
  ImagePlatform,
  VideoPlatform,
  ClipboardPlatform,
  DragDropPlatform,
  ProjectPackagePlatform,
  WindowPlatform,
  LoggingPlatform,
  UpdaterPlatform,
}
export * from './aiRuntime'
export * from './llmRuntime'
export * from './db'
export * from './keystore'
export * from './system'
export * from './media'
export * from './image'
export * from './video'
export * from './clipboard'
export * from './dragDrop'
export * from './projectPackage'
export * from './window'
export * from './logging'
export * from './updater'
