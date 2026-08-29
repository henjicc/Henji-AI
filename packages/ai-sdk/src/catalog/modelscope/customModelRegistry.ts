/**
 * 魔搭（ModelScope）用户自建模型的运行时注册表。
 *
 * 这是一份纯内存、无外部依赖的读写缓存，被 `modelscope-custom.model.ts` 的
 * `inputLimits`/`request.builder` 直接读取（判断自定义模型是否支持图片编辑），
 * 因此必须和这两个运行时函数一起留在 SDK 里，不能整体划给展示层——它是
 * "模型是什么"的一部分（决定输入约束与请求体），只是取值来源是用户运行时配置
 * 而非编译期常量。
 *
 * 真正的持久化（SQLite via databaseService、localStorage 旧数据迁移）与 CRUD 流程
 * 留在痕迹AI 侧的 `src/services/modelscopeCustomModels/ModelscopeCustomModelService.ts`，
 * 该服务通过 `replaceModelscopeCustomModels` 把加载好的数据推送进这份注册表——
 * 服务层依赖数据库/IPC，明显是应用侧关注点，不属于 SDK。
 */
export interface ModelscopeCustomModelRegistryEntry {
  id: string
  name: string
  costTier?: string
  magicGrainCost?: number
  modelType: {
    imageGeneration: boolean
    imageEditing: boolean
  }
}

let customModels: ModelscopeCustomModelRegistryEntry[] = []

export function replaceModelscopeCustomModels(models: ModelscopeCustomModelRegistryEntry[]): void {
  customModels = models.map((model) => {
    const costTier = typeof model.costTier === 'string' && model.costTier.trim().length > 0
      ? model.costTier.trim()
      : undefined
    const magicGrainCost = typeof model.magicGrainCost === 'number'
      && Number.isFinite(model.magicGrainCost)
      && model.magicGrainCost >= 0
      ? model.magicGrainCost
      : undefined

    return {
      id: model.id,
      name: model.name,
      ...(costTier ? { costTier } : {}),
      ...(magicGrainCost !== undefined ? { magicGrainCost } : {}),
      modelType: {
        imageGeneration: model.modelType.imageGeneration,
        imageEditing: model.modelType.imageEditing,
      },
    }
  })
}

export function getModelscopeCustomModel(modelId: string): ModelscopeCustomModelRegistryEntry | undefined {
  return customModels.find((model) => model.id === modelId)
}
