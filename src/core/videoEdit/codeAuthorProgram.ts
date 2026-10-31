import type { CodeAuthorApiVersionNumber } from './codeAuthorVersions'
import type { ContentTrustReference } from '../contentTrust'
import type { CodeMaterialMetadata } from './codeMaterialDocument'
import type { CodeMatrix, CodeSourceSpan } from './codeMaterial/contract'

/** Explicit author layer metadata, captured only for editing/observation. */
export interface AuthorElementObservation {
  kind?: 'adjust'
  clip?: [number, number, number, number]
  effects?: import('./authorEffects').ResolvedAuthorEffect[]
  effectsTime?: number
  id: string
  name: string
  bounds?: [number, number, number, number]
  baseMatrix?: CodeMatrix
  baseOpacity?: number
  opacity?: number
  matrix: CodeMatrix
  corners: [number, number][]
  sourceSpan?: CodeSourceSpan
  factory?: { file: string; name: string }
  parameterKeys: string[]
  textParameterKeys: string[]
  textDraws?: import('./textDrawObservation').TextDrawObservation[]
  canvasReview?: AuthorCanvasReviewObservation[]
  textUncovered?: string[]
  textLayouts?: string[]
  unassignedTextLayouts?: string[]
  data?: { parameter: string; index: number; key?: string | number; keyField?: string; value: unknown }
}
export interface CodeAuthorFrameObservation {
  sequenceId: string
  revision: number
  frame: number
  clips: Array<{ clipId: string; versionId: string; width: number; height: number; elements: AuthorElementObservation[] }>
}
/** 录制到的几何事实；不是对最终像素或卡片语义的推断。坐标在作者图层内。 */
export interface AuthorCanvasReviewObservation {
  retained?: boolean
  layerIndex?: number
  kind: 'text' | 'box' | 'shadow_outside_source'
  text?: string
  quad: [number, number][]
  opacity: number
}

export interface CodeAuthorSourceLocations {
  layers: Record<string, CodeSourceSpan>
  factories?: Record<string, Record<string, CodeSourceSpan>>
  fallback?: CodeSourceSpan
}
export interface CodeAuthorBundle {
  /** 导入标记随可重建产物传递；运行许可始终由宿主判断。 */
  trustContext?: ContentTrustReference[]
  code: string
  map: string
  locations: CodeAuthorSourceLocations
  modules?: import('./codeMaterial/sources').CodeMaterialFiles
  /** 静态导入到的内置库（库名 → 版本），供工程记录所用版本；没有用到时省略。 */
  libraries?: import('./codeMaterial/authorLibraries').AuthorLibraryVersions
  /** 编译时指定的作者接口版本；省略即 4。读取声明的程序沿用它，与代码版本记录保持一致。 */
  apiVersion?: CodeAuthorApiVersion
}
export type CodeAuthorApiVersion = CodeAuthorProgram['apiVersion']

/** Rebuildable executable module plus declarations read in the render worker.
 * Source files, parameters and overrides remain the persisted truth. */
export interface CodeAuthorProgram extends CodeMaterialMetadata {
  apiVersion: CodeAuthorApiVersionNumber
  languageVersion: 4
  bundle: CodeAuthorBundle
  frames: number[]
  hexColors: string[]
}
