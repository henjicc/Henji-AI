import type { CodeAuthorApiVersionNumber } from './codeAuthorVersions'
import type { ContentTrustReference } from '../contentTrust'
import type { CodeMaterialMetadata } from './codeMaterialDocument'
import type { CodeMatrix, CodeSourceSpan } from './codeMaterial/contract'
import type { WebTextDeclaration } from './webTextGeometry'

/** Explicit author layer metadata, captured only for editing/observation. */
export interface AuthorElementObservation {
  kind?: 'adjust'
  clip?: [number, number, number, number]
  effects?: import('./authorEffects').ResolvedAuthorEffect[]
  effectStates?: import('./authorEffects').AuthorElementEffectState[]
  edits?: import('./codeEdits').CodeEdits
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
  clips: Array<{ clipId: string; versionId: string; width: number; height: number; edits?: import('./codeEdits').CodeEdits; elements: AuthorElementObservation[] }>
  /** 这一帧三维里实际画了什么（序列有三维组时才有）。 */
  space?: import('./spatialObservation').SpatialFrameObservation
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
  /** 源码里每个作者图层对象的 id 都是唯一的字面量：layers 列全了，不在其中的元素才能断定已从源码删除。 */
  staticLayerIds?: true
  /** layers 里写了 adjust 的图层 id；作者接口支持调整层时它们是调整层，不必等当前帧观察。 */
  adjustLayerIds?: string[]
  factories?: Record<string, Record<string, CodeSourceSpan>>
  fallback?: CodeSourceSpan
}
export interface CodeAuthorBundle {
  /** 文字新版接口的可达模块静态字体资源；只存在于可重建编译产物，不落盘。 */
  textEntry?: string
  textFonts?: ReadonlyArray<{ file: string } & import('./codeMaterial/textFonts').StaticTextFonts>
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
  webText?: WebTextDeclaration
  simulation?: Required<import('./codeSimulation').AuthorSimulationDeclaration>
  languageVersion: 4
  bundle: CodeAuthorBundle
  frames: number[]
  hexColors: string[]
}
