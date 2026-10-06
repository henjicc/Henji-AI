import type { EmbeddedAgentPlatform } from '../../src/core/assistant/embeddedAgent'
import type { HenjiAssistantApi } from './api-assistant'
import type { ApplicationHostPlatform, McpPlatform } from '../../src/core/application-control/localHostContracts'
import type {
  HenjiCameraStageRenderApi,
  HenjiCustomModelsApi,
  HenjiTestFixturesApi,
  HenjiDiagnosticsApi,
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
  HenjiShellApi,
  HenjiUpdaterApi,
} from './api-desktop'
import type { HenjiImageEditorV3Api } from './image-editor-v3-api'
import type { HenjiVideoFramesApi } from './api-video-frames'
import type { HenjiVideoDecoderApi } from './api-video-decoder'
import type { HenjiDocumentsApi } from './api-documents'
import type { WorkRootPlatform } from '../../src/platform/contracts/workRoot'
import type { LocalModelsPlatform } from '../../src/platform/contracts/localModels'
import type { SmartRegionsPlatform } from '../../src/platform/contracts/smartRegions'
import type { TrackingPlatform } from '../../src/platform/contracts/tracking'
import type { SceneDetectionPlatform } from '../../src/platform/contracts/sceneDetection'
import type { HenjiGenerationHistoryApi, HenjiPresetsApi, HenjiSettingsApi } from './api-local-records'

export * from './api-assistant'
export * from './api-projects'
export * from './api-ai'
export * from './api-media'
export * from './api-desktop'
export type { HenjiImageEditorV3Api } from './image-editor-v3-api'
export type { HenjiVideoFramesApi } from './api-video-frames'
export type { HenjiVideoDecoderApi } from './api-video-decoder'
export type { HenjiDocumentsApi } from './api-documents'
export type { HenjiGenerationHistoryApi, HenjiPresetsApi, HenjiSettingsApi } from './api-local-records'

export interface HenjiNativeApi {
  embeddedAgent: EmbeddedAgentPlatform
  applicationControl: ApplicationHostPlatform
  mcp: McpPlatform
  runtimeInfo: {
    uiInspectionActive: boolean
    uiInspectionGpuInitializationFailure: boolean
    uiInspectionReadOnly: boolean
  }
  assistant: HenjiAssistantApi
  ai: HenjiAiApi
  llm: HenjiLlmApi
  /** 原始 SQL 通道：只在自动化 / 隔离测试模式下存在（测试脚本造画布数据用），生产代码不得使用；3.4 删除。 */
  /** 测试夹具：只在自动化 / 隔离测试模式下存在。 */
  testFixtures?: HenjiTestFixturesApi
  generationHistory: HenjiGenerationHistoryApi
  presets: HenjiPresetsApi
  settings: HenjiSettingsApi
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
  videoFrames: HenjiVideoFramesApi
  videoDecoder: HenjiVideoDecoderApi
  audio: HenjiAudioApi
  clipboard: HenjiClipboardApi
  drag: HenjiDragApi
  logging: HenjiLoggingApi
  updater: HenjiUpdaterApi
  modelscope: Record<string, never>
  window: HenjiWindowApi
  diagnostics: HenjiDiagnosticsApi
  assetLibrary: HenjiAssetLibraryApi
  documents: HenjiDocumentsApi
  /** 作品目录位置与更换，接口与 PAL `WorkRootPlatform` 相同。 */
  workRoot: WorkRootPlatform
  /** 本地模型下载与管理，接口与 PAL `LocalModelsPlatform` 相同。 */
  localModels: LocalModelsPlatform
  /** 剪辑智能区域分析（4.7d），接口与 PAL `SmartRegionsPlatform` 相同。 */
  smartRegions: SmartRegionsPlatform
  tracking: TrackingPlatform
  sceneDetection: SceneDetectionPlatform
}

declare global {
  interface Window {
    henjiNative?: HenjiNativeApi
  }
}

export {}
