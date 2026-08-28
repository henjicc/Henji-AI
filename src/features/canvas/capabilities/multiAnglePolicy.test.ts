import { describe, expect, it } from 'vitest'

import {
  MULTI_ANGLE_CONTINUOUS_ENDPOINT_ID,
  MULTI_ANGLE_CONTINUOUS_MODEL_ID,
  MULTI_ANGLE_DISCRETE_ENDPOINT_ID,
  MULTI_ANGLE_DISCRETE_MODEL_ID,
  createDefaultMultiAngleConfig,
  createMultiAngleBatchPlan,
  createMultiAngleCommitContract,
  normalizeMultiAngleConfig,
  validateMultiAngleConfig,
} from './multiAnglePolicy'

describe('多角度版本化参数契约', () => {
  it('默认为连续档 4 视图、并发 2，且不存在提示词字段', () => {
    const config = createDefaultMultiAngleConfig()
    expect(config).toMatchObject({ version: 1, controlProfile: 'continuous-v1', concurrency: 2 })
    expect(config.views.map((view) => view.label)).toEqual([
      '左三分之四', '右三分之四', '左侧面', '右侧面',
    ])
    expect(JSON.stringify(config)).not.toContain('prompt')
  })

  it('迁移旧 id/azimuth/elevation/shotSize 并在唯一入口夹紧模型控制范围', () => {
    const config = normalizeMultiAngleConfig({
      views: [{ id: 'legacy', label: '旧视图', azimuth: 200, elevation: -5, shotSize: 'close-up' }],
    })
    expect(config.views[0]).toEqual({
      viewId: 'legacy',
      kind: 'continuous',
      label: '旧视图',
      presetId: 'three-quarter-left',
      yawControlDeg: 90,
      verticalControl: -1,
      proximity: 7,
      wideAngle: false,
    })
  })

  it('拒绝未知版本、超过 6 视图、重复编号与重复控制', () => {
    expect(() => normalizeMultiAngleConfig({ version: 2 })).toThrow(/不支持/)
    const base = createDefaultMultiAngleConfig()
    expect(() => validateMultiAngleConfig({ ...base, views: [...base.views, ...base.views] })).toThrow(/1 到 6/)
    expect(() => validateMultiAngleConfig({ ...base, views: [base.views[0], base.views[0]] })).toThrow(/编号重复/)
    expect(() => validateMultiAngleConfig({
      ...base,
      views: [base.views[0], { ...base.views[0], viewId: 'another' }],
    })).toThrow(/控制重复/)
  })

  it('两个 profile 映射固定 Fal 模型与端点，离散档不伪造数值角度', () => {
    const continuous = createMultiAngleBatchPlan(createDefaultMultiAngleConfig('continuous-v1'), 'source.png')
    expect(continuous[0]).toMatchObject({
      modelId: MULTI_ANGLE_CONTINUOUS_MODEL_ID,
      endpointId: MULTI_ANGLE_CONTINUOUS_ENDPOINT_ID,
      precision: 'learned-native',
      params: { image: ['source.png'], rotateRightLeft: 45 },
    })
    const discrete = createMultiAngleBatchPlan(createDefaultMultiAngleConfig('discrete-v1'), 'source.png')
    expect(discrete[0]).toMatchObject({
      modelId: MULTI_ANGLE_DISCRETE_MODEL_ID,
      endpointId: MULTI_ANGLE_DISCRETE_ENDPOINT_ID,
      precision: 'discrete-native',
      params: { image: ['source.png'], targetPerspective: 'front' },
      cameraControl: { kind: 'discrete', preset: 'front' },
    })
    expect(discrete[0].cameraControl).not.toHaveProperty('yawControlDeg')
  })

  it('完整输出按用户顺序生成 4.1 image-group 描述，不按完成时间', () => {
    const plan = createMultiAngleBatchPlan(createDefaultMultiAngleConfig(), 'source.png')
    const contract = createMultiAngleCommitContract([
      { plan: plan[3], mediaUrl: 'd.png', providerRequestId: 'req-d' },
      { plan: plan[0], mediaUrl: 'a.png', providerRequestId: 'req-a' },
      { plan: plan[2], mediaUrl: 'c.png', providerRequestId: 'req-c' },
      { plan: plan[1], mediaUrl: 'b.png', providerRequestId: 'req-b' },
    ])
    expect(contract).toMatchObject({
      strategy: 'assetGroup',
      resultKind: 'image-group',
      expectedOutputCount: 4,
    })
    expect(contract.outputs.map((item) => item.source)).toEqual(['a.png', 'b.png', 'c.png', 'd.png'])
    expect(contract.outputs[0].descriptor).toMatchObject({
      order: 0,
      sourceOutputIndex: 0,
      semantic: { kind: 'camera-view', label: '左三分之四' },
      profile: { id: 'continuous-v1', precision: 'learned-native' },
      metadata: { providerId: 'fal', providerRequestId: 'req-a' },
    })
  })

  it('不允许完整契约混用 profile 或缺失顺序', () => {
    const continuous = createMultiAngleBatchPlan(createDefaultMultiAngleConfig(), 'source.png')
    const discrete = createMultiAngleBatchPlan(createDefaultMultiAngleConfig('discrete-v1'), 'source.png')
    expect(() => createMultiAngleCommitContract([
      { plan: continuous[0], mediaUrl: 'a.png', providerRequestId: 'a' },
      { plan: discrete[1], mediaUrl: 'b.png', providerRequestId: 'b' },
    ])).toThrow(/顺序不连续或混用/)
  })
})
