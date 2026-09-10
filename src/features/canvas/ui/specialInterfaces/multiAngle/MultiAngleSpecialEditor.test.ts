import { describe, expect, it } from 'vitest'

import {
  MULTI_ANGLE_DISCRETE_MODEL_ID,
  MULTI_ANGLE_FLUX_MODEL_ID,
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

  it('按度数写入 2511 连续控制契约', () => {
    const draft = buildMultiAngleEditorDraft({}, {
      views: [{ viewId: 'angle', label: '视图', yawControlDeg: 30, elevationDeg: -30, proximity: 7 }],
    })
    expect(draft.multiAngleConfig).toMatchObject({
      version: 1,
      controlProfile: 'continuous-v1',
      concurrency: 2,
      views: [{
        viewId: 'angle',
        yawControlDeg: 30,
        elevationDeg: -30,
        proximity: 7,
      }],
    })
  })

  it('切换到 FLUX 原生档时写入独立模型与独立角度语义', () => {
    const config = createDefaultMultiAngleConfig('flux-native-v1')
    const draft = buildMultiAngleEditorDraft({ modelId: MULTI_ANGLE_DISCRETE_MODEL_ID }, config)

    expect(draft).toMatchObject({
      modelId: MULTI_ANGLE_FLUX_MODEL_ID,
      prompt: '',
      params: {},
      multiAngleConfig: {
        version: 1,
        controlProfile: 'flux-native-v1',
        concurrency: 2,
      },
    })
    expect((draft.multiAngleConfig as { views: DynamicValueMap[] }).views).toHaveLength(1)
    expect((draft.multiAngleConfig as { views: DynamicValueMap[] }).views[0]).toMatchObject({
      kind: 'flux',
      horizontalAngleDeg: 0,
      verticalAngleDeg: 0,
      zoom: 5,
    })
    expect(JSON.stringify(draft.multiAngleConfig)).not.toContain('yawControlDeg')
  })
})
