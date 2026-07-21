/**
 * 参数流转追踪器
 * 用于追踪参数从 UI 输入到 API 请求的完整流程
 */

import type { ParamFlowRecord, FlowStage, Linkage } from './types'

export class ParamFlowTracker {
  private records: ParamFlowRecord[] = []
  private currentRecord: ParamFlowRecord | null = null
  private maxRecords = 10  // 最多保留 10 条记录

  /**
   * 开始追踪
   */
  startTracking(modelId: string): void {
    this.currentRecord = {
      timestamp: Date.now(),
      modelId,
      stages: []
    }
  }

  /**
   * 记录 UI 输入阶段
   */
  recordUIInput(params: DynamicValueMap): void {
    if (!this.currentRecord) return

    const stage: FlowStage = {
      stage: 'ui-input',
      timestamp: Date.now(),
      params: {}
    }

    Object.entries(params).forEach(([key, value]) => {
      stage.params[key] = {
        value,
        source: 'user-input'
      }
    })

    this.currentRecord.stages.push(stage)
  }

  /**
   * 记录联动阶段
   */
  recordLinkage(
    triggeredBy: string,
    changes: DynamicValueMap,
    linkageRule: Linkage
  ): void {
    if (!this.currentRecord) return

    const stage: FlowStage = {
      stage: 'linkage',
      timestamp: Date.now(),
      params: {}
    }

    Object.entries(changes).forEach(([key, value]) => {
      stage.params[key] = {
        value,
        source: 'linkage',
        changedBy: triggeredBy,
        reason: `Linkage effect: ${linkageRule.effect} triggered by ${triggeredBy}`
      }
    })

    this.currentRecord.stages.push(stage)
  }

  /**
   * 记录转换阶段
   */
  recordTransform(
    paramId: string,
    fromValue: DynamicValue,
    toValue: DynamicValue,
    transformer: string
  ): void {
    if (!this.currentRecord) return

    let transformStage = this.currentRecord.stages.find(
      s => s.stage === 'transform'
    )

    if (!transformStage) {
      transformStage = {
        stage: 'transform',
        timestamp: Date.now(),
        params: {}
      }
      this.currentRecord.stages.push(transformStage)
    }

    transformStage.params[paramId] = {
      value: toValue,
      source: 'transform',
      transformedFrom: fromValue,
      reason: `Transformed by ${transformer}`
    }
  }

  /**
   * 记录 API 构建阶段
   */
  recordAPIBuild(apiParams: DynamicValueMap): void {
    if (!this.currentRecord) return

    const stage: FlowStage = {
      stage: 'api-build',
      timestamp: Date.now(),
      params: {}
    }

    Object.entries(apiParams).forEach(([key, value]) => {
      stage.params[key] = {
        value,
        source: 'api-build'
      }
    })

    this.currentRecord.stages.push(stage)
  }

  /**
   * 结束追踪
   */
  finishTracking(): ParamFlowRecord {
    if (!this.currentRecord) {
      throw new Error('No tracking in progress')
    }

    const record = this.currentRecord
    this.records.push(record)

    // 限制记录数量
    if (this.records.length > this.maxRecords) {
      this.records.shift()
    }

    this.currentRecord = null
    return record
  }

  /**
   * 获取追踪记录
   */
  getRecords(): ParamFlowRecord[] {
    return [...this.records]
  }

  /**
   * 获取最新的追踪记录
   */
  getLatestRecord(): ParamFlowRecord | null {
    return this.records.length > 0 ? this.records[this.records.length - 1] : null
  }

  /**
   * 清空记录
   */
  clearRecords(): void {
    this.records = []
    this.currentRecord = null
  }

  /**
   * 导出记录为 JSON
   */
  exportRecord(record: ParamFlowRecord): void {
    const blob = new Blob(
      [JSON.stringify(record, null, 2)],
      { type: 'application/json' }
    )
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `param-flow-${record.modelId}-${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
  }
}
