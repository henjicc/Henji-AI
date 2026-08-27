import type { ModelRuntimeDefinition } from '../types/model'

export interface ModelIndex {
  get(modelId: string): ModelRuntimeDefinition | undefined
  providerIds(): string[]
  len(): number
  list(): readonly ModelRuntimeDefinition[]
}

/**
 * 为编译期 catalog 建立 ID/alias 索引。
 *
 * 保持历史索引的覆盖顺序：真实 model ID 始终覆盖同名 alias；多个模型
 * 声明同一 alias 时保留先声明者。这样旧工程 ID 的解析不会因删除 manifest 而改变。
 */
export function createModelIndex(models: readonly ModelRuntimeDefinition[]): ModelIndex {
  const entries = [...models]
  const byId = new Map<string, ModelRuntimeDefinition>()

  for (const model of entries) {
    byId.set(model.meta.id, model)
    for (const alias of model.meta.aliases ?? []) {
      if (!byId.has(alias)) {
        byId.set(alias, model)
      }
    }
  }

  return {
    get(modelId: string): ModelRuntimeDefinition | undefined {
      return byId.get(modelId)
    },
    providerIds(): string[] {
      return Array.from(new Set(entries.map((model) => model.meta.provider)))
    },
    len(): number {
      return entries.length
    },
    list(): readonly ModelRuntimeDefinition[] {
      return entries
    },
  }
}
