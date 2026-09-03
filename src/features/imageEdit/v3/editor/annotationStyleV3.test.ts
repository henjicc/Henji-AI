import { describe, expect, it } from 'vitest'

import type { MarkItem } from '@/core/imageEdit/types'
import {
  ANNOTATION_DEFAULT_STROKE_HEX,
  ANNOTATION_DEFAULT_TEXT_HEX,
  BLACK_HEX,
} from '@/core/theme/colorTokens'
import { patchAnnotationStyleV3, readAnnotationStyleV3 } from './annotationStyleV3'

describe('V3 标注样式双向同步', () => {
  it('颜色与描边只修改当前形状并保留几何', () => {
    const annotation: MarkItem = {
      id: 'rect-a',
      type: 'rect',
      x: 10,
      y: 20,
      width: 100,
      height: 80,
      stroke: ANNOTATION_DEFAULT_STROKE_HEX,
      lineWidth: 3,
    }
    expect(patchAnnotationStyleV3(annotation, { color: ANNOTATION_DEFAULT_TEXT_HEX, lineWidth: 9 })).toEqual({
      ...annotation,
      stroke: ANNOTATION_DEFAULT_TEXT_HEX,
      lineWidth: 9,
    })
  })

  it('带文字标注同步字号并可在矩形与椭圆之间切换', () => {
    const annotation: MarkItem = {
      id: 'callout-a',
      type: 'rect',
      x: 10,
      y: 20,
      width: 100,
      height: 80,
      stroke: ANNOTATION_DEFAULT_STROKE_HEX,
      lineWidth: 3,
      label: '重点',
      labelFontSize: 24,
    }
    const next = patchAnnotationStyleV3(annotation, { fontSize: 40, calloutShape: 'ellipse' })
    expect(next).toMatchObject({ type: 'ellipse', label: '重点', labelFontSize: 40 })
    expect(readAnnotationStyleV3(next)).toMatchObject({ fontSize: 40, calloutShape: 'ellipse' })
  })

  it('文字与序号读取并更新自己的颜色和字号', () => {
    const annotation: MarkItem = {
      id: 'text-a',
      type: 'text',
      x: 2,
      y: 3,
      text: '说明',
      color: ANNOTATION_DEFAULT_TEXT_HEX,
      fontSize: 18,
    }
    const next = patchAnnotationStyleV3(annotation, { color: BLACK_HEX, fontSize: 36 })
    expect(readAnnotationStyleV3(next)).toEqual({
      color: BLACK_HEX,
      lineWidth: null,
      fontSize: 36,
      calloutShape: null,
      textBackgroundEnabled: false,
      textBackgroundColor: null,
      mosaicMode: null,
      mosaicStrength: null,
    })
  })

  it('恢复文字背景与打码模式的双向样式修改', () => {
    const text: MarkItem = {
      id: 'text-background', type: 'text', x: 2, y: 3,
      text: '说明', color: BLACK_HEX, fontSize: 18,
    }
    const withBackground = patchAnnotationStyleV3(text, {
      textBackgroundEnabled: true,
      textBackgroundColor: ANNOTATION_DEFAULT_TEXT_HEX,
    })
    expect(withBackground).toMatchObject({ backgroundColor: ANNOTATION_DEFAULT_TEXT_HEX })

    const mosaic: MarkItem = {
      id: 'mosaic-a', type: 'mosaic', x: 0, y: 0, width: 40, height: 30,
      mode: 'pixel', strengthPercent: 2,
    }
    const blurred = patchAnnotationStyleV3(mosaic, { mosaicMode: 'blur', mosaicStrength: 5 })
    expect(blurred).toMatchObject({ mode: 'blur', strengthPercent: 5 })
    expect(readAnnotationStyleV3(blurred)).toMatchObject({
      mosaicMode: 'blur', mosaicStrength: 5,
    })
  })
})
