/** 生成任务失败后的调用方中立恢复约束。 */
export interface GenerationTaskRecoveryInput {
  taskId: string
  modelId: string
  status: string
  errorCode: string | null
  errorMessage: string | null
}

export interface GenerationTaskRecoveryAdvice {
  strategy: 'correct_same_model_parameters'
  sourceTaskId: string
  sourceModelId: string
  fallbackAllowed: false
  reason: string
  requiredSteps: ['get_model_schema', 'prepare_generation_task', 'create_visible_generation_task']
}

function isProviderParameterFailure(message: string): boolean {
  const normalized = message.toLowerCase()
  return /aspect[_\s-]?ratio|resolution|dimensions?|image[_\s-]?size|allowed options?|invalid (?:input )?parameter|parameter validation/.test(normalized)
}

/**
 * 将可见生成任务的终态转换为 Agent 可执行的恢复约束。
 * 供应商已明确拒绝参数时，保留同一模型是唯一安全默认值；换模型会改变能力、价格和结果预期。
 */
export function createGenerationTaskRecoveryAdvice(
  input: GenerationTaskRecoveryInput
): GenerationTaskRecoveryAdvice | null {
  if (input.status !== 'error' || !input.errorMessage || !isProviderParameterFailure(input.errorMessage)) {
    return null
  }
  return {
    strategy: 'correct_same_model_parameters',
    sourceTaskId: input.taskId,
    sourceModelId: input.modelId,
    fallbackAllowed: false,
    reason: '供应商明确拒绝了生成参数；应先按当前模型的最新参数结构修正后重试。',
    requiredSteps: ['get_model_schema', 'prepare_generation_task', 'create_visible_generation_task'],
  }
}
