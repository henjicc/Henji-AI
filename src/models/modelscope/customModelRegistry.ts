export interface ModelscopeCustomModelRegistryEntry {
  id: string
  name: string
  modelType: {
    imageGeneration: boolean
    imageEditing: boolean
  }
}

let customModels: ModelscopeCustomModelRegistryEntry[] = []

export function replaceModelscopeCustomModels(models: ModelscopeCustomModelRegistryEntry[]): void {
  customModels = models.map((model) => ({
    id: model.id,
    name: model.name,
    modelType: {
      imageGeneration: model.modelType.imageGeneration,
      imageEditing: model.modelType.imageEditing,
    },
  }))
}

export function getModelscopeCustomModel(modelId: string): ModelscopeCustomModelRegistryEntry | undefined {
  return customModels.find((model) => model.id === modelId)
}
