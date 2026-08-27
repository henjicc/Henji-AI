import { createLogger } from '@/core/logging'

const logger = createLogger('core.loaders.modelLoader')
/**
 * 模型文件自动加载器
 *
 * 自动扫描并加载所有 *.model.ts 文件
 */

import { registry } from '../ModelRegistry'
import { getI18nText } from '../types/I18nText'
import { defineModel as defineApplicationModel } from '../defineModel'
import { composeModelDefinition } from '../composeModelDefinition'
import { catalog } from '@henjicc/ai-sdk'
import { modelPresentations } from '@/models/presentation'

/**
 * 加载统计信息
 */
interface LoadStats {
  total: number
  success: number
  failed: number
  duration: number
}

/**
 * 加载所有模型文件
 *
 * 消费 SDK 的显式 catalog 清单，并与应用侧展示补丁组合后注册到 ModelRegistry。
 *
 * @returns 加载统计信息
 */
export async function loadAllModels(): Promise<LoadStats> {
  // logger.info('[ModelLoader] 🚀 Loading models...')

  // 清空现有的注册表，防止重复注册（例如在 React StrictMode 下）
  registry.clear()

  const startTime = performance.now()

  let successCount = 0
  let errorCount = 0
  const failedModels: Array<{ path: string; error: DynamicValue }> = []

  for (const runtimeModel of catalog) {
    const path = runtimeModel.meta.id
    try {
      const presentation = modelPresentations[runtimeModel.meta.id]
      if (!presentation) {
        throw new Error(`Missing model presentation: ${runtimeModel.meta.id}`)
      }

      const model = composeModelDefinition(runtimeModel, presentation)
      // 应用侧 defineModel 保留既有的 canonical 描述补丁与 i18nScope 展开，并完成注册。
      defineApplicationModel(model)

      successCount++
    } catch (error) {
      logger.error(`[ModelLoader] ✗ Failed to load ${path}:`, error)
      failedModels.push({ path, error })
      errorCount++
    }
  }

  const duration = performance.now() - startTime

  // 输出加载摘要
  const total = successCount + errorCount
  // logger.info(
  //   `[ModelLoader] 📊 Complete: ${successCount}/${total} loaded, ${errorCount} failed (${duration.toFixed(2)}ms)`
  // )

  // 如果有失败的模型，输出详细错误信息
  if (failedModels.length > 0 && import.meta.env.DEV) {
    logger.group('[ModelLoader] ❌ Failed Models Details:')
    failedModels.forEach(({ path, error }) => {
      logger.error(`- ${path}:`, error.message || error)
    })
    logger.groupEnd()
  }

  return {
    total,
    success: successCount,
    failed: errorCount,
    duration
  }
}

/**
 * 列出所有已加载的模型（调试用）
 *
 * 在控制台以表格形式输出所有已加载的模型信息
 *
 * @example
 * ```typescript
 * // 在浏览器控制台调用
 * window.__listModels()
 * ```
 */
export function listLoadedModels(): void {
  const models = registry.listAllModels()

  logger.info(`[ModelLoader] 📋 Total Models: ${models.length}`)
    logger.table(
      models.map((m) => ({
        ID: m.meta.id,
        Provider: m.meta.provider,
        Type: m.meta.type,
        Name: getI18nText(m.meta.name, 'zh'),
        Params: m.params.length,
        Linkages: m.linkages?.length || 0,
        Tags: m.meta.tags?.join(', ') || '-'
      }))
    )
}

/**
 * 获取加载器统计信息（调试用）
 *
 * @returns 注册中心统计信息
 *
 * @example
 * ```typescript
 * // 在浏览器控制台调用
 * window.__getModelStats()
 * ```
 */
export function getLoaderStats(): void {
  const stats = registry.getStats()

  logger.info('[ModelLoader] 📈 Registry Statistics:')
  logger.info('━'.repeat(50))
  logger.info(`Total Models:      ${stats.totalModels}`)
  logger.info(`Total Aliases:     ${stats.totalAliases}`)
  logger.info(`Total Entries:     ${stats.totalEntries}`)
  logger.info('━'.repeat(50))
  logger.info(`Image Models:      ${stats.imageModels}`)
  logger.info(`Video Models:      ${stats.videoModels}`)
  logger.info(`Audio Models:      ${stats.audioModels}`)
  logger.info('━'.repeat(50))
  logger.info('Providers:')
  Object.entries(stats.providerCounts).forEach(([provider, count]) => {
    logger.info(`  - ${provider}: ${count}`)
  })
  logger.info('━'.repeat(50))
  logger.info('Top Tags:')
  stats.topTags.forEach((item: DynamicValue) => {
    logger.info(`  - ${item.tag}: ${item.count}`)
  })
}

/**
 * 重新加载所有模型（调试用）
 *
 * 清空注册中心并重新加载所有模型
 * 仅在开发模式下可用
 *
 * @example
 * ```typescript
 * // 在浏览器控制台调用
 * window.__reloadModels()
 * ```
 */
export async function reloadModels(): Promise<void> {
  if (!import.meta.env.DEV) {
    logger.warn('[ModelLoader] reloadModels() is only available in development mode')
    return
  }

  logger.info('[ModelLoader] 🔄 Reloading all models...')

  // 清空注册中心
  registry.clear()

  // 重新加载
  await loadAllModels()

  logger.info('[ModelLoader] ✅ Reload complete')
}

// ========== 开发环境调试工具 ==========

if (import.meta.env.DEV) {
  // 暴露调试函数到 window 对象
  (window as DynamicValue).__listModels = listLoadedModels
  ;(window as DynamicValue).__getModelStats = getLoaderStats
  ;(window as DynamicValue).__reloadModels = reloadModels

  logger.info('[ModelLoader] 🛠️  Debug tools available:')
  logger.info('  - window.__listModels()      - List all loaded models')
  logger.info('  - window.__getModelStats()   - Show registry statistics')
  logger.info('  - window.__reloadModels()    - Reload all models')
}

// ========== Vite HMR 支持 ==========

if (import.meta.hot) {
  import.meta.hot.accept((_newModule) => {
    logger.info('[HMR] 🔥 Model loader updated, reloading models...')
    reloadModels()
  })
}
