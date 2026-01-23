/**
 * ExportService - 导出服务
 *
 * 提供统一的配置导出功能
 */

import { registry } from '../ModelRegistry'
import { requestBuilder } from '../request/RequestBuilder'
import { ParamCleaner } from './ParamCleaner'
import type { ExportData, ExportType, ExportOptions } from './types'

/**
 * 导出服务类
 */
export class ExportService {
  private cleaner: ParamCleaner
  private version = '1.0.0'

  constructor() {
    this.cleaner = new ParamCleaner()
  }

  /**
   * 导出当前参数
   *
   * @param modelId - 模型 ID
   * @param params - 参数对象
   * @param options - 导出选项
   * @returns 导出数据
   */
  exportCurrentParams(
    modelId: string,
    params: Record<string, any>,
    options: ExportOptions = {}
  ): ExportData {
    const schema = registry.getSchema(modelId)

    // 清理参数
    let cleanedParams = params
    if (options.clean) {
      cleanedParams = this.cleaner.clean(params, options.clean, schema)
    }

    return this.createExportData('current-params', modelId, cleanedParams, options)
  }

  /**
   * 导出模型配置
   *
   * @param modelId - 模型 ID
   * @param options - 导出选项
   * @returns 导出数据
   */
  exportModelConfig(modelId: string, options: ExportOptions = {}): ExportData {
    const model = registry.getModel(modelId)

    if (!model) {
      throw new Error(`Model not found: ${modelId}`)
    }

    return this.createExportData('model-config', modelId, model, options)
  }

  /**
   * 导出模型 Schema
   *
   * @param modelId - 模型 ID
   * @param options - 导出选项
   * @returns 导出数据
   */
  exportModelSchema(modelId: string, options: ExportOptions = {}): ExportData {
    const schema = registry.getSchema(modelId)

    return this.createExportData('model-schema', modelId, schema, options)
  }

  /**
   * 导出 API 请求
   *
   * @param modelId - 模型 ID
   * @param params - 参数对象
   * @param context - 上下文
   * @param options - 导出选项
   * @returns 导出数据
   */
  async exportAPIRequest(
    modelId: string,
    params: Record<string, any>,
    context: Record<string, any> = {},
    options: ExportOptions = {}
  ): Promise<ExportData> {
    const request = await requestBuilder.build(modelId, params, { context })

    return this.createExportData('api-request', modelId, request, options)
  }

  /**
   * 导出为预设格式
   *
   * @param modelId - 模型 ID
   * @param params - 参数对象
   * @param presetName - 预设名称
   * @param options - 导出选项
   * @returns 导出数据
   */
  exportAsPreset(
    modelId: string,
    params: Record<string, any>,
    presetName: string,
    options: ExportOptions = {}
  ): ExportData {
    const schema = registry.getSchema(modelId)

    // 清理参数
    let cleanedParams = params
    if (options.clean) {
      cleanedParams = this.cleaner.clean(params, options.clean, schema)
    }

    const presetData = {
      name: presetName,
      modelId,
      params: cleanedParams
    }

    return this.createExportData('preset', modelId, presetData, options)
  }

  /**
   * 通用导出方法
   *
   * @param type - 导出类型
   * @param modelId - 模型 ID
   * @param data - 数据
   * @param options - 导出选项
   * @returns 导出数据
   */
  export(
    type: ExportType,
    modelId: string,
    data: any,
    options: ExportOptions = {}
  ): ExportData {
    return this.createExportData(type, modelId, data, options)
  }

  /**
   * 下载为 JSON 文件
   *
   * @param data - 导出数据
   * @param filename - 文件名（可选）
   */
  downloadAsJSON(data: ExportData, filename?: string): void {
    const json = JSON.stringify(data, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)

    const a = document.createElement('a')
    a.href = url
    a.download = filename || this.generateFilename(data)
    a.click()

    URL.revokeObjectURL(url)
  }

  /**
   * 复制到剪贴板
   *
   * @param data - 导出数据
   * @returns Promise
   */
  async copyToClipboard(data: ExportData): Promise<void> {
    const json = JSON.stringify(data, null, 2)
    await navigator.clipboard.writeText(json)
  }

  /**
   * 创建导出数据
   *
   * @param type - 导出类型
   * @param modelId - 模型 ID
   * @param data - 数据
   * @param options - 导出选项
   * @returns 导出数据
   */
  private createExportData(
    type: ExportType,
    modelId: string,
    data: any,
    options: ExportOptions
  ): ExportData {
    const exportData: ExportData = {
      version: this.version,
      type,
      timestamp: Date.now(),
      modelId,
      data
    }

    // 添加元数据
    if (options.includeMetadata !== false) {
      exportData.metadata = {
        appVersion: '1.0.0', // TODO: 从配置获取
        platform: navigator.platform
      }
    }

    return exportData
  }

  /**
   * 生成文件名
   *
   * @param data - 导出数据
   * @returns 文件名
   */
  private generateFilename(data: ExportData): string {
    const date = new Date(data.timestamp).toISOString().split('T')[0]
    return `${data.type}-${data.modelId}-${date}.json`
  }
}

/**
 * 单例实例
 */
export const exportService = new ExportService()
