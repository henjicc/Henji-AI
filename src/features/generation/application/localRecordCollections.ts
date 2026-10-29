import { jsonValueSchema } from '@/core/application-control/identifiers'
import { databaseService } from '@/services/database'
import { modelscopeCustomModelService } from '@/services/modelscopeCustomModels/ModelscopeCustomModelService'
import { createRecyclableRecordSource, RecyclableCollectionExecutor } from '@/features/application-control'
import { deletePersistedGenerationTask } from '@/workspaces/GenerationWorkspace/application/generationTaskHistory'

export const presetCollection = createRecyclableRecordSource({
  entityType: 'generation.preset', domain: 'generation', title: '生成预设',
  list: async () => (await databaseService.getPresets()).map(record => ({ id: record.id, name: record.name, content: jsonValueSchema.parse(record) })),
  remove: async id => { await databaseService.deletePreset(id); return `presets:${id}` },
})
export const customModelCollection = createRecyclableRecordSource({
  entityType: 'generation.custom_model', domain: 'generation', title: '自定义模型配置',
  list: async () => (await databaseService.getCustomModels()).map(record => ({ id: record.id, name: record.name, content: jsonValueSchema.parse(record) })),
  remove: async id => { await modelscopeCustomModelService.deleteModel(id); return `custom_models:${id}` },
})
export const historyCollectionExecutor = new RecyclableCollectionExecutor('generation.record', {
  read: async ref => { const record = await databaseService.getHistoryById(ref.id); if (!record) throw new Error('NOT_FOUND'); return record },
  remove: async ref => { await deletePersistedGenerationTask(ref.id); return `history:${ref.id}` },
  revisions: () => ({ generation: 0 }),
})
