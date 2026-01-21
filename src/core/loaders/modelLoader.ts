/**
 * 模型文件自动加载器
 *
 * 自动扫描并加载所有 *.model.ts 文件
 */

import { registry } from '../ModelRegistry'
import type { ModelDefinition } from '../types'

/**
 * 模型模块接口
 */
interface ModelModule {
  default: ModelDefinition
}

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
 * 使用 Vite 的 import.meta.glob 自动扫描 src/models/**/*.model.ts 文件
 * 并自动注册到 ModelRegistry
 *
 * @returns 加载统计信息
 *
 * @example
 * ```typescript
 * import { loadAllModels } from '@/core/loaders'
 *
 * async function initApp() {
 *   const stats = await loadAllModels()
 *   console.log(`Loaded ${stats.success} models`)
 * }
 * ```
 */
export async function loadAllModels(): Promise<LoadStats> {
  console.log('[ModelLoader] 🚀 Loading models...')

  const startTime = performance.now()

  // 使用 Vite 的 import.meta.glob 扫描所有 .model.ts 文件
  // eager: true 表示在构建时就加载所有模块（同步加载）
  const modules = import.meta.glob<ModelModule>(
    '/src/models/**/*.model.ts',
    { eager: true }
  )

  let successCount = 0
  let errorCount = 0
  const failedModels: Array<{ path: string; error: any }> = []

  // 遍历所有模块并注册
  for (const [path, module] of Object.entries(modules)) {
    try {
      // 1. 验证模块格式
      if (!module || !module.default) {
        throw new Error('Model file must have a default export')
      }

      const model = module.default

      // 2. 验证模型基本结构
      if (!model.meta) {
        throw new Error('Model must have a meta property')
      }

      if (!model.meta.id) {
        throw new Error('Model meta must have an id')
      }

      // 3. 注册到 ModelRegistry
      registry.register(model)

      console.log(`[ModelLoader] ✓ Loaded: ${model.meta.id} (${path})`)
      successCount++
    } catch (error) {
      console.error(`[ModelLoader] ✗ Failed to load ${path}:`, error)
      failedModels.push({ path, error })
      errorCount++
    }
  }

  const duration = performance.now() - startTime

  // 输出加载摘要
  const total = successCount + errorCount
  console.log(
    `[ModelLoader] 📊 Complete: ${successCount}/${total} loaded, ${errorCount} failed (${duration.toFixed(2)}ms)`
  )

  // 如果有失败的模型，输出详细错误信息
  if (failedModels.length > 0 && import.meta.env.DEV) {
    console.group('[ModelLoader] ❌ Failed Models Details:')
    failedModels.forEach(({ path, error }) => {
      console.error(`- ${path}:`, error.message || error)
    })
    console.groupEnd()
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

  console.log(`[ModelLoader] 📋 Total Models: ${models.length}`)
  console.table(
    models.map((m) => ({
      ID: m.meta.id,
      Provider: m.meta.provider,
      Type: m.meta.type,
      Name: typeof m.meta.name === 'string' ? m.meta.name : m.meta.name.zh || m.meta.name.en,
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

  console.log('[ModelLoader] 📈 Registry Statistics:')
  console.log('━'.repeat(50))
  console.log(`Total Models:      ${stats.totalModels}`)
  console.log(`Total Aliases:     ${stats.totalAliases}`)
  console.log(`Total Entries:     ${stats.totalEntries}`)
  console.log('━'.repeat(50))
  console.log(`Image Models:      ${stats.imageModels}`)
  console.log(`Video Models:      ${stats.videoModels}`)
  console.log(`Audio Models:      ${stats.audioModels}`)
  console.log('━'.repeat(50))
  console.log('Providers:')
  Object.entries(stats.providerCounts).forEach(([provider, count]) => {
    console.log(`  - ${provider}: ${count}`)
  })
  console.log('━'.repeat(50))
  console.log('Top Tags:')
  stats.topTags.forEach((item: any) => {
    console.log(`  - ${item.tag}: ${item.count}`)
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
    console.warn('[ModelLoader] reloadModels() is only available in development mode')
    return
  }

  console.log('[ModelLoader] 🔄 Reloading all models...')

  // 清空注册中心
  registry.clear()

  // 重新加载
  await loadAllModels()

  console.log('[ModelLoader] ✅ Reload complete')
}

// ========== 开发环境调试工具 ==========

if (import.meta.env.DEV) {
  // 暴露调试函数到 window 对象
  ;(window as any).__listModels = listLoadedModels
  ;(window as any).__getModelStats = getLoaderStats
  ;(window as any).__reloadModels = reloadModels

  console.log('[ModelLoader] 🛠️  Debug tools available:')
  console.log('  - window.__listModels()      - List all loaded models')
  console.log('  - window.__getModelStats()   - Show registry statistics')
  console.log('  - window.__reloadModels()    - Reload all models')
}

// ========== Vite HMR 支持 ==========

if (import.meta.hot) {
  import.meta.hot.accept((newModule) => {
    console.log('[HMR] 🔥 Model loader updated, reloading models...')
    reloadModels()
  })
}
