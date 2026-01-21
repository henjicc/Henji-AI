/**
 * 参数流转追踪数据类型定义
 */

/**
 * 参数流转记录
 */
export interface ParamFlowRecord {
  timestamp: number
  modelId: string
  stages: FlowStage[]
}

/**
 * 流转阶段
 */
export interface FlowStage {
  stage: 'ui-input' | 'linkage' | 'transform' | 'api-build'
  timestamp: number
  params: Record<string, ParamValueRecord>
}

/**
 * 参数值记录
 */
export interface ParamValueRecord {
  value: any
  source?: 'user-input' | 'default' | 'linkage' | 'transform' | 'api-build'
  changedBy?: string       // 被哪个联动规则修改
  transformedFrom?: any    // 转换前的值
  reason?: string          // 变化原因
}

/**
 * 联动规则（简化版，用于追踪）
 */
export interface Linkage {
  trigger: string
  effect: string
  targets: string[]
}
