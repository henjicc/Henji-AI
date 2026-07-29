import { describe, expect, it } from 'vitest'

import type { ParamDef } from '@/core/types'
import { transferModelParamOverrides } from './modelParamTransfer'

function dropdown(
  id: string,
  name: string,
  defaultValue: string | number,
  options: Array<string | number>,
  apiField?: string,
  transferKey?: string
): ParamDef {
  return {
    id,
    type: 'dropdown',
    order: 1,
    name: { zh: name, en: name },
    default: defaultValue,
    apiField,
    transferKey,
    options: options.map((value) => ({ value, label: String(value) })),
  }
}

function numberParam(
  id: string,
  name: string,
  defaultValue: number,
  min: number,
  max: number,
  step: number,
  apiField?: string
): ParamDef {
  return {
    id,
    type: 'number',
    order: 1,
    name: { zh: name, en: name },
    default: defaultValue,
    min,
    max,
    step,
    apiField,
  }
}

function switchParam(
  id: string,
  name: string,
  defaultValue: boolean,
  apiField?: string,
  transferKey?: string
): ParamDef {
  return {
    id,
    type: 'switch',
    order: 1,
    name: { zh: name, en: name },
    default: defaultValue,
    apiField,
    transferKey,
  }
}

function transfer(
  sourceSchema: ParamDef[],
  targetSchema: ParamDef[],
  sourceValues: DynamicValueMap
): DynamicValueMap {
  return transferModelParamOverrides({
    sourceSchema,
    targetSchema,
    sourceValues,
    sourceDefaults: Object.fromEntries(sourceSchema.map((param) => [param.id, param.default])),
  })
}

describe('模型切换参数迁移', () => {
  it('将不同取值命名的宽高比转换为目标模型的等价选项', () => {
    const source = dropdown(
      'falAspectRatio',
      '宽高比',
      'smart',
      ['smart', 'portrait_16_9', 'landscape_16_9'],
      'aspect_ratio'
    )
    const target = dropdown(
      'kieRatio',
      '画面比例',
      '16:9',
      ['1:1', '9:16', '16:9'],
      'aspect_ratio'
    )

    expect(transfer([source], [target], { falAspectRatio: 'portrait_16_9' })).toEqual({
      kieRatio: '9:16',
    })
  })

  it('目标模型不支持原分辨率时选择最接近的合法档位', () => {
    const source = dropdown(
      'sourceResolution',
      '分辨率',
      '720P',
      ['720P', '1080P', '4K'],
      'resolution'
    )
    const target = dropdown(
      'targetQuality',
      '视频画质',
      '720p',
      ['480p', '720p', '1080p'],
      'quality'
    )

    expect(transfer([source], [target], { sourceResolution: '4K' })).toEqual({
      targetQuality: '1080p',
    })
  })

  it('数值参数按目标范围与步长修正', () => {
    const source = numberParam('sourceDuration', '视频时长', 5, 1, 30, 1, 'duration')
    const target = numberParam('targetDuration', '生成时长', 4, 2, 10, 2, 'duration')

    expect(transfer([source], [target], { sourceDuration: 13 })).toEqual({
      targetDuration: 10,
    })
  })

  it('不迁移用户没有修改过的源模型默认值', () => {
    const source = dropdown('sourceRatio', '宽高比', '9:16', ['9:16', '16:9'], 'aspect_ratio')
    const target = dropdown('targetRatio', '宽高比', '1:1', ['1:1', '9:16'], 'aspect_ratio')

    expect(transfer([source], [target], { sourceRatio: '9:16' })).toEqual({})
  })

  it('不会根据相同字段名自动迁移音频等可能影响费用的开关', () => {
    const source = switchParam('sourceAudio', '生成音频', false, 'audio')
    const target = switchParam('targetAudio', '生成音频', false, 'audio')

    expect(transfer([source], [target], { sourceAudio: true })).toEqual({})
  })

  it('允许模型 schema 用 transferKey 显式声明特殊参数对应关系', () => {
    const source = switchParam('sourceAudio', '生成音频', false, 'audio', 'video.generated-audio')
    const target = switchParam('targetSound', '生成声音', false, 'sound', 'video.generated-audio')

    expect(transfer([source], [target], { sourceAudio: true })).toEqual({
      targetSound: true,
    })
  })

  it('显示名相同的安全枚举参数即使 ID 不同也保留用户选择', () => {
    const source = dropdown('sourceStyle', '画面风格', 'general', ['general', 'anime'])
    const target = dropdown('targetStyle', '画面风格', 'general', ['general', 'anime'])

    expect(transfer([source], [target], { sourceStyle: 'anime' })).toEqual({
      targetStyle: 'anime',
    })
  })

  it('真实 Kling 跨供应商切换时保留画面参数但不传播音频开关', () => {
    const sourceSchema = [
      dropdown('falKlingV26ProVideoDuration', '时长', 5, [5, 10]),
      dropdown('falKlingV26ProAspectRatio', '宽高比', '16:9', ['16:9', '9:16', '1:1']),
      dropdown('falKlingV26ProResolution', '分辨率', '720p', ['720p', '1080p']),
      switchParam('falKlingV26ProGenerateAudio', '生成音频', true),
    ]
    const targetSchema = [
      dropdown('kieKlingV26Duration', '时长', '5', ['5', '10']),
      dropdown('kieKlingV26AspectRatio', '宽高比', '16:9', ['16:9', '9:16', '1:1', 'smart']),
      dropdown('kieKlingV26Resolution', '分辨率', '720p', ['720p', '1080p']),
      switchParam('kieKlingV26EnableAudio', '生成音频', true),
    ]
    const sourceDefaults = Object.fromEntries(sourceSchema.map((param) => [param.id, param.default]))
    const overrides = transferModelParamOverrides({
      sourceSchema,
      targetSchema,
      sourceDefaults,
      sourceValues: {
        ...sourceDefaults,
        falKlingV26ProVideoDuration: 10,
        falKlingV26ProAspectRatio: '9:16',
        falKlingV26ProResolution: '1080p',
        falKlingV26ProGenerateAudio: false,
      },
    })

    expect(overrides).toMatchObject({
      kieKlingV26Duration: '10',
      kieKlingV26AspectRatio: '9:16',
      kieKlingV26Resolution: '1080p',
    })
    expect(overrides).not.toHaveProperty('kieKlingV26EnableAudio')
  })
})
