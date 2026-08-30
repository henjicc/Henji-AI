import type { ReactNode } from 'react'

import type { CanvasNodeData, CanvasNodeType } from '@/features/canvas/domain/canvasNodes'
import type { CanvasImageCapabilityId } from '@/features/canvas/capabilities'

import type { GenerationNodeShellData } from './useGenerationPromptDocument'
import type {
  GenerationNodeRequestPreparation,
  GenerationNodeResultCommitContext,
  GenerationNodeResultCommitResult,
  GenerationNodeRuntimePreparationContext,
} from './generationNodeExecutionTypes'

export interface GenerationNodeWorkbenchContext {
  images: readonly string[]
  videos: readonly string[]
  audios: readonly string[]
}

export interface GenerationNodeShellProps {
  id: string
  nodeType: CanvasNodeType
  data: GenerationNodeShellData
  selected?: boolean
  width?: number
  height?: number
  icon?: ReactNode
  /** i18n 键：提示词占位/必填提示/无 API Key 提示/结果节点默认标题 */
  promptPlaceholderKey: string
  promptRequiredKey: string
  apiKeyRequiredKey: string
  resultTitleKey: string
  /** 结果节点的附加初始数据（如 resultKind） */
  resultNodeExtraData?: DynamicValueMap | ((data: CanvasNodeData) => DynamicValueMap)
  /** 图片产品能力编号；声明后共享壳会统一执行模型筛选、固定语义、模板和结果记录。 */
  capabilityId?: CanvasImageCapabilityId
  /** 无提示词工具（如忠实超分）可隐藏编辑器，并跳过文本必填校验。 */
  showPromptInput?: boolean
  requirePrompt?: boolean
  /** 供应商对可选提示词有更小上限时，同步约束编辑器与执行前校验。 */
  promptMaxCharacters?: number
  /** 固定模型工具隐藏模型行，并忽略历史模型选择器连线覆盖。 */
  showModelInput?: boolean
  /** 已由主媒体行或能力面板承载、不应重复呈现的 schema 参数。 */
  excludeParamIds?: readonly string[]
  /** 在供应商配置/上传/计费前执行的本地预检，可补充仅供运行时使用的隐藏参数。 */
  prepareRuntimeParams?: (
    context: GenerationNodeRuntimePreparationContext,
  ) => Promise<DynamicValueMap> | DynamicValueMap
  /** 仅在正式运行时准备裁剪等有副作用的媒体，并把恢复所需上下文持久化到结果节点。 */
  prepareGenerationRequest?: (
    context: GenerationNodeRuntimePreparationContext,
  ) => Promise<GenerationNodeRequestPreparation> | GenerationNodeRequestPreparation
  /** 结构化结果可注入领域提交器；共享壳不按 capabilityId/modelId 判断输出协议。 */
  commitGenerationResult?: (
    context: GenerationNodeResultCommitContext,
  ) => Promise<GenerationNodeResultCommitResult>
  /** 复用标准生成壳时追加的能力语义行；只放产品设置，不复制模型 schema 参数。 */
  additionalInputRows?: ReactNode
  /** 图片工具节点使用横向工作台；普通生成节点保持 stacked。 */
  layoutMode?: 'stacked' | 'workbench'
  /** 工作台左侧的专属交互；省略时显示当前源媒体预览。 */
  workbenchStage?: ReactNode | ((context: GenerationNodeWorkbenchContext) => ReactNode)
  /** 未提供专属交互时覆盖在源媒体预览底部的简短状态。 */
  workbenchSummary?: ReactNode
  minWidth?: number
  minHeight?: number
  maxWidth?: number
  maxHeight?: number
}
