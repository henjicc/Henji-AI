import { describe, expect, it } from 'vitest'

import type { ImageUploadParamDef } from '@/core/types'
import {
  derivedMediaStateKey,
  reconcileDerivedMediaState,
  resolveDerivedMediaSource,
  stripDerivedMediaState,
} from './derivedMediaState'

const maskParam: ImageUploadParamDef = {
  id: 'maskUrl',
  type: 'image-upload',
  order: 1,
  name: { zh: '遮罩', en: 'Mask' },
  default: [],
  valueType: 'array',
  derivedMediaAuthoring: {
    kind: 'mask',
    source: { kind: 'first-image' },
    editor: { kind: 'mask' },
    output: {
      format: 'png',
      maskEncoding: 'alpha',
      paintMeaning: 'transparent-edit',
      dimensions: 'source',
    },
    onSourceChange: 'invalidate',
    actions: {
      create: { zh: '绘制', en: 'Draw' },
      edit: { zh: '编辑', en: 'Edit' },
    },
  },
}

describe('derivedMediaState', () => {
  it('按生成页、画布、提交边界的优先级解析首张图片', () => {
    expect(resolveDerivedMediaSource(maskParam, {
      uploadedImages: ['preview-a'],
      images: ['canvas-a'],
      uploadedFilePaths: ['/managed/a.png'],
    })).toBe('preview-a')
    expect(resolveDerivedMediaSource(maskParam, { images: ['canvas-a'] })).toBe('canvas-a')
    expect(resolveDerivedMediaSource(maskParam, { uploadedFilePaths: ['/managed/a.png'] })).toBe('/managed/a.png')
  })

  it('来源未变化时保留遮罩与编辑文档', () => {
    const stateKey = derivedMediaStateKey(maskParam.id)
    const values = {
      uploadedImages: ['source-a'],
      maskUrl: ['/managed/mask.png'],
      [stateKey]: { version: 1, sourceRef: 'source-a', strokes: [] },
    }
    expect(reconcileDerivedMediaState([maskParam], values)).toBe(values)
  })

  it('来源替换或删除时同时清除遮罩与编辑文档', () => {
    const stateKey = derivedMediaStateKey(maskParam.id)
    const values = {
      uploadedImages: ['source-b'],
      maskUrl: ['/managed/mask.png'],
      [stateKey]: { version: 1, sourceRef: 'source-a', strokes: [] },
    }
    const reconciled = reconcileDerivedMediaState([maskParam], values)
    expect(reconciled.maskUrl).toEqual([])
    expect(reconciled).not.toHaveProperty(stateKey)
  })

  it('提交前仅剥离应用专属编辑文档', () => {
    const stateKey = derivedMediaStateKey(maskParam.id)
    const values = {
      images: ['source-a'],
      maskUrl: ['/managed/mask.png'],
      [stateKey]: { version: 1, sourceRef: 'source-a', strokes: [] },
    }
    expect(stripDerivedMediaState(values)).toEqual({
      images: ['source-a'],
      maskUrl: ['/managed/mask.png'],
    })
  })
})
