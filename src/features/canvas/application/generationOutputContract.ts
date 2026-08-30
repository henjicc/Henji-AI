import {
  CANVAS_GENERATION_RESULT_KINDS,
  CANVAS_GENERATION_OUTPUT_STRATEGIES,
  type CanvasGenerationOutputBatchContractV1,
  type CanvasGenerationOutputItem,
  type CanvasGenerationOutputStrategy,
} from '../domain/generationOutputs'
import { GenerationOutputApplicationError } from './generationOutputApplicationContracts'

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new GenerationOutputApplicationError('INVALID_INPUT', `多结果输出字段 ${field} 不能为空`)
  }
  return value.trim()
}

/**
 * 纯契约校验同时返回稳定顺序；调用方不得按网络完成顺序落图。
 */
export function validateGenerationOutputBatchContract(
  contract: CanvasGenerationOutputBatchContractV1,
): CanvasGenerationOutputItem[] {
  if (contract.version !== 1) {
    throw new GenerationOutputApplicationError('INVALID_INPUT', `不支持的多结果契约版本：${String(contract.version)}`)
  }
  if (contract.outputs.length === 0) {
    throw new GenerationOutputApplicationError('INVALID_INPUT', '生成结果为空，无法创建结果节点')
  }
  if (!CANVAS_GENERATION_OUTPUT_STRATEGIES.includes(contract.strategy)) {
    throw new GenerationOutputApplicationError('INVALID_INPUT', `未知的多结果落图策略：${String(contract.strategy)}`)
  }
  if (!CANVAS_GENERATION_RESULT_KINDS.includes(contract.resultKind)) {
    throw new GenerationOutputApplicationError('INVALID_INPUT', `未知的结果语义：${String(contract.resultKind)}`)
  }
  if (
    contract.expectedOutputCount !== undefined
    && (!Number.isInteger(contract.expectedOutputCount) || contract.expectedOutputCount < 1)
  ) {
    throw new GenerationOutputApplicationError('INVALID_INPUT', '预期输出数量必须为正整数')
  }
  if (
    contract.expectedOutputCount !== undefined
    && contract.outputs.length !== contract.expectedOutputCount
  ) {
    throw new GenerationOutputApplicationError(
      'INVALID_INPUT',
      `生成结果数量不符：预期 ${contract.expectedOutputCount}，实际 ${contract.outputs.length}`,
    )
  }
  if (contract.strategy === 'single' && contract.outputs.length !== 1) {
    throw new GenerationOutputApplicationError('INVALID_INPUT', 'single 策略必须且只能包含一个输出')
  }
  if (contract.strategy === 'assetGroup' && contract.outputs.length < 2) {
    throw new GenerationOutputApplicationError('INVALID_INPUT', 'assetGroup 策略至少需要两个输出')
  }
  if (
    contract.strategy === 'assetGroup'
    && contract.resultKind !== 'image-group'
    && contract.resultKind !== 'media-group'
  ) {
    throw new GenerationOutputApplicationError('INVALID_INPUT', 'assetGroup 策略的结果语义必须为 image-group 或 media-group')
  }
  if (contract.strategy === 'layer-stack' && contract.resultKind !== 'layer-stack') {
    throw new GenerationOutputApplicationError('INVALID_INPUT', 'layer-stack 策略的结果语义必须为 layer-stack')
  }

  const outputIds = new Set<string>()
  const sourceIndexes = new Set<number>()
  const orders = new Set<number>()
  for (const item of contract.outputs) {
    requireNonEmptyString(item.source, 'source')
    const descriptor = item.descriptor
    if (descriptor.version !== 1) {
      throw new GenerationOutputApplicationError('INVALID_INPUT', '输出描述符版本必须为 1')
    }
    const outputId = requireNonEmptyString(descriptor.outputId, 'outputId')
    if (outputIds.has(outputId)) {
      throw new GenerationOutputApplicationError('INVALID_INPUT', `输出编号重复：${outputId}`)
    }
    outputIds.add(outputId)
    if (!Number.isInteger(descriptor.order) || descriptor.order < 0 || orders.has(descriptor.order)) {
      throw new GenerationOutputApplicationError('INVALID_INPUT', `输出顺序无效或重复：${descriptor.order}`)
    }
    orders.add(descriptor.order)
    if (
      !Number.isInteger(descriptor.sourceOutputIndex)
      || descriptor.sourceOutputIndex < 0
      || sourceIndexes.has(descriptor.sourceOutputIndex)
    ) {
      throw new GenerationOutputApplicationError(
        'INVALID_INPUT',
        `来源输出索引无效或重复：${descriptor.sourceOutputIndex}`,
      )
    }
    sourceIndexes.add(descriptor.sourceOutputIndex)
    requireNonEmptyString(descriptor.semantic.kind, 'semantic.kind')
    if (!CANVAS_GENERATION_RESULT_KINDS.includes(descriptor.semantic.resultKind)) {
      throw new GenerationOutputApplicationError('INVALID_INPUT', `未知的成员结果语义：${String(descriptor.semantic.resultKind)}`)
    }
    if (!['image', 'video', 'audio'].includes(descriptor.mediaType)) {
      throw new GenerationOutputApplicationError('INVALID_INPUT', `未知的媒体类型：${String(descriptor.mediaType)}`)
    }
    if (descriptor.profile) {
      requireNonEmptyString(descriptor.profile.id, 'profile.id')
      if (descriptor.profile.precision !== undefined) {
        requireNonEmptyString(descriptor.profile.precision, 'profile.precision')
      }
    }
    if (contract.strategy === 'layer-stack') {
      if (!descriptor.layer || descriptor.layer.index !== descriptor.order) {
        throw new GenerationOutputApplicationError('INVALID_INPUT', '图层栈输出必须提供与顺序一致的 layer.index')
      }
      if (
        descriptor.layer.opacity !== undefined
        && (!Number.isFinite(descriptor.layer.opacity)
          || descriptor.layer.opacity < 0
          || descriptor.layer.opacity > 1)
      ) {
        throw new GenerationOutputApplicationError('INVALID_INPUT', '图层透明度必须位于 0 到 1 之间')
      }
      if (descriptor.layer.blendMode !== undefined) {
        requireNonEmptyString(descriptor.layer.blendMode, 'layer.blendMode')
      }
    }
  }

  const ordered = [...contract.outputs].sort((left, right) => (
    left.descriptor.order - right.descriptor.order
    || left.descriptor.sourceOutputIndex - right.descriptor.sourceOutputIndex
  ))
  if (ordered.some((item, index) => item.descriptor.order !== index)) {
    throw new GenerationOutputApplicationError('INVALID_INPUT', '输出顺序必须从 0 开始且连续')
  }
  return ordered
}

export function resolveGenerationOutputStrategy(input: {
  outputCount: number
  resultKind?: string
}): CanvasGenerationOutputStrategy {
  if (input.resultKind === 'layer-stack') return 'layer-stack'
  if (input.outputCount === 1) return 'single'
  return 'assetGroup'
}
