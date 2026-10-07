import { describe, expect, it } from 'vitest'
import { migrateLayerStackResultData } from './nodeCapabilityMigrations'

describe('多图层占位节点跨项目恢复', () => {
  it.each([true, false])('未有文档的占位节点保留图层语义与原任务，isGenerating=%s', (isGenerating) => {
    const data: DynamicValueMap = {
      resultKind: 'image', imageUrl: null, isGenerating,
      serverTaskId: 'existing-task', serverTaskModelId: 'kie-seedream-5.0-pro',
      generationError: isGenerating ? null : '下载未完成',
    }
    migrateLayerStackResultData(data)
    expect(data).toMatchObject({ resultKind: 'layer-stack', serverTaskId: 'existing-task', isGenerating })
  })

})
