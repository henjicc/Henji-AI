import { describe, expect, it } from 'vitest'

import {
  MULTI_ANGLE_CONTINUOUS_ENDPOINT_ID,
  MULTI_ANGLE_CONTINUOUS_MODEL_ID,
  MULTI_ANGLE_DISCRETE_ENDPOINT_ID,
  MULTI_ANGLE_DISCRETE_MODEL_ID,
  MULTI_ANGLE_FLUX_ENDPOINT_ID,
  MULTI_ANGLE_FLUX_MODEL_ID,
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

  it('FLUX 档只迁移同语义字段，并夹紧原生 0–360/0–60/0–10 范围', () => {
    const config = normalizeMultiAngleConfig({
      version: 1,
      controlProfile: 'flux-native-v1',
      views: [{
        id: 'legacy-flux',
        label: '旧 FLUX 视图',
        horizontalAngle: 450,
        verticalAngle: -5,
        zoom: 12,
      }],
    })
    expect(config).toEqual({
      version: 1,
      controlProfile: 'flux-native-v1',
      concurrency: 2,
      views: [{
        viewId: 'legacy-flux',
        kind: 'flux',
        label: '旧 FLUX 视图',
        presetId: 'front',
        horizontalAngleDeg: 360,
        verticalAngleDeg: 0,
        zoom: 10,
      }],
    })
    expect(config.views[0]).not.toHaveProperty('yawControlDeg')
    expect(config.views[0]).not.toHaveProperty('proximity')
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

    const flux = createDefaultMultiAngleConfig('flux-native-v1')
    const first = flux.views[0]
    if (first.kind !== 'flux') throw new Error('缺少 FLUX 视图')
    expect(() => validateMultiAngleConfig({
      ...flux,
      views: [
        { ...first, viewId: 'front-0', horizontalAngleDeg: 0 },
        { ...first, viewId: 'front-360', horizontalAngleDeg: 360 },
      ],
    })).toThrow(/控制重复/)
  })

  it('三个 profile 映射各自固定 Fal 模型、端点与原生参数', () => {
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

    const fluxConfig = createDefaultMultiAngleConfig('flux-native-v1')
    const fluxView = fluxConfig.views[0]
    if (fluxView.kind !== 'flux') throw new Error('FLUX 默认配置缺少原生视图')
    fluxConfig.views = [{
      ...fluxView,
      horizontalAngleDeg: 360,
      verticalAngleDeg: 60,
      zoom: 10,
    }]
    const flux = createMultiAngleBatchPlan(fluxConfig, 'source.png')
    expect(flux[0]).toMatchObject({
      modelId: MULTI_ANGLE_FLUX_MODEL_ID,
      endpointId: MULTI_ANGLE_FLUX_ENDPOINT_ID,
      profile: 'flux-native-v1',
      precision: 'numeric-native',
      params: {
        image: ['source.png'],
        horizontalAngle: 360,
        verticalAngle: 60,
        zoom: 10,
      },
      cameraControl: {
        kind: 'flux',
        horizontalAngleDeg: 360,
        verticalAngleDeg: 60,
        zoom: 10,
      },
    })
    expect(flux[0].params).not.toHaveProperty('rotateRightLeft')
    expect(flux[0].params).not.toHaveProperty('targetPerspective')

    const contract = createMultiAngleCommitContract([{
      plan: flux[0],
      mediaUrl: 'flux.png',
      providerRequestId: 'req-flux',
    }])
    expect(contract.outputs[0].descriptor).toMatchObject({
      profile: { id: 'flux-native-v1', precision: 'numeric-native' },
      angle: {
        control: {
          kind: 'flux',
          horizontalAngleDeg: 360,
          verticalAngleDeg: 60,
          zoom: 10,
        },
      },
      metadata: {
        providerId: 'fal',
        endpointId: MULTI_ANGLE_FLUX_ENDPOINT_ID,
        providerRequestId: 'req-flux',
      },
    })
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
