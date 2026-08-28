import { describe, expect, it } from 'vitest'

import {
  MULTI_ANGLE_DISCRETE_MODEL_ID,
  createDefaultMultiAngleConfig,
} from '@/features/canvas/capabilities/multiAnglePolicy'
import { buildMultiAngleEditorDraft } from './multiAngleEditorState'

describe('多角度编辑器草稿', () => {
  it('切换 profile 会原子替换配置和执行模型，且不保留伪提示词', () => {
    const config = createDefaultMultiAngleConfig('discrete-v1')
    const draft = buildMultiAngleEditorDraft({
      prompt: '旧提示词',
      params: { legacy: true },
      multiAngleBatch: { version: 1 },
      multiAngleResultPlaceholderId: 'old-result',
    }, config)

    expect(draft).toMatchObject({
      modelId: MULTI_ANGLE_DISCRETE_MODEL_ID,
      prompt: '',
      params: {},
      multiAngleConfig: config,
    })
    expect(draft).toMatchObject({
      multiAngleBatch: { version: 1 },
      multiAngleResultPlaceholderId: 'old-result',
    })
  })

  it('迁移旧相机字段后写入版本化连续控制契约', () => {
    const draft = buildMultiAngleEditorDraft({}, {
      views: [{ id: 'legacy', label: '旧视图', azimuth: 30, elevation: -0.5, shotSize: 'close-up' }],
    })
    expect(draft.multiAngleConfig).toMatchObject({
      version: 1,
      controlProfile: 'continuous-v1',
      concurrency: 2,
      views: [{
        viewId: 'legacy',
        yawControlDeg: 30,
        verticalControl: -0.5,
        proximity: 7,
      }],
    })
  })
})
