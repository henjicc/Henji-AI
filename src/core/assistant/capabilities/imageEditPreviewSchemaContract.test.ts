import { describe, expect, it } from 'vitest'

import {
  ANNOTATION_DEFAULT_STROKE_HEX,
  ANNOTATION_DEFAULT_TEXT_HEX,
  BLACK_HEX,
  IMAGE_EDITOR_GLOW_TINT_HEX,
  IMAGE_EDITOR_PRESET_COLORS,
} from '../../theme/colorTokens'
import { BUILTIN_APPLICATION_CAPABILITY_REGISTRY } from '../builtinApplicationCapabilityRegistry'
import {
  IMAGE_EDIT_PREVIEW_CAPABILITY_METADATA,
} from '../../../features/imageEdit/application/imageEditControlCatalog'
import { createImageEditReflectionRegistrations } from '../../../features/imageEdit/application/imageEditReflection'
import { TOOLBOX_APPLICATION_CAPABILITIES } from './toolboxApplicationCapabilities'

type JsonRecord = Record<string, unknown>

function asRecord(value: unknown): JsonRecord {
  expect(value).toBeTruthy()
  expect(typeof value).toBe('object')
  expect(Array.isArray(value)).toBe(false)
  return value as JsonRecord
}

function property(schema: unknown, key: string): JsonRecord {
  return asRecord(asRecord(asRecord(schema).properties)[key])
}

function operationVariants(schema: unknown): JsonRecord[] {
  const items = asRecord(property(schema, 'operations').items)
  expect(Array.isArray(items.oneOf)).toBe(true)
  return (items.oneOf as unknown[]).map(asRecord)
}

function operationVariant(schema: unknown, kind: string): JsonRecord {
  const variant = operationVariants(schema).find((candidate) => (
    property(candidate, 'kind').const === kind
  ))
  expect(variant, `AI schema 缺少图片编辑操作 ${kind}`).toBeDefined()
  return asRecord(variant)
}

function markItemVariant(schema: unknown, type: string): JsonRecord {
  const item = property(operationVariant(schema, 'mark'), 'item')
  expect(Array.isArray(item.oneOf)).toBe(true)
  const variant = (item.oneOf as unknown[]).map(asRecord).find((candidate) => (
    property(candidate, 'type').const === type
  ))
  expect(variant, `AI schema 缺少图片标注类型 ${type}`).toBeDefined()
  return asRecord(variant)
}

describe('图片编辑预览能力契约', () => {
  const canonicalPreview = TOOLBOX_APPLICATION_CAPABILITIES.find((capability) => (
    capability.id === 'create_image_edit_preview'
  ))

  it('只保留一条正式预览能力，并暴露完整受限 operations AI schema', () => {
    expect(canonicalPreview).toBeDefined()
    expect(canonicalPreview?.version).toBe(2)
    expect(canonicalPreview?.title).toBe(IMAGE_EDIT_PREVIEW_CAPABILITY_METADATA.title)
    expect(canonicalPreview?.description).toBe(IMAGE_EDIT_PREVIEW_CAPABILITY_METADATA.description)
    expect(canonicalPreview?.aliases).toEqual([...IMAGE_EDIT_PREVIEW_CAPABILITY_METADATA.aliases])
    expect(canonicalPreview?.acceptsRefs).toEqual([
      'asset',
      'generation.result',
      'image_edit.preview',
    ])
    expect(BUILTIN_APPLICATION_CAPABILITY_REGISTRY.get('create_image_edit_preview_from_ref'))
      .toBeUndefined()

    expect(canonicalPreview?.aiInputSchema.additionalProperties).toBe(false)
    const sourceRef = property(canonicalPreview?.aiInputSchema, 'sourceRef')
    expect(property(sourceRef, 'kind').enum).toEqual([
      'asset',
      'generation.result',
      'image_edit.preview',
    ])
    expect(canonicalPreview?.inputSchema.safeParse({
      sourceRef: { kind: 'image_edit.preview', id: 'preview-1' },
      operations: [{ kind: 'vgpu_glow', look: 'neon' }],
    }).success).toBe(true)
    const variants = operationVariants(canonicalPreview?.aiInputSchema)
    expect(variants).toHaveLength(9)
    expect(variants.every((variant) => variant.additionalProperties === false)).toBe(true)

    const operations = property(canonicalPreview?.aiInputSchema, 'operations')
    expect(operations.description).not.toContain('按数组顺序应用')
    expect(operations.description).toContain('最终按编辑器固定阶段执行')
    expect(operations.description).not.toContain('后项参数为准')
    expect(operations.description).not.toContain('后项启用')
  })

  it('能力发现能看到柔光与辉光 Pro 的枚举、范围、字段说明和嵌套边界', () => {
    const diffusion = operationVariant(canonicalPreview?.aiInputSchema, 'diffusion')
    expect(property(diffusion, 'mode').enum).toEqual(['black_mist', 'white_mist', 'glow'])
    expect(property(diffusion, 'density').enum).toEqual(['low', 'medium', 'high'])
    expect(property(diffusion, 'glowExposure')).toMatchObject({ minimum: 0, maximum: 1 })
    expect(property(diffusion, 'glowExposure').description).toContain('仅 glow 模式生效')
    expect(property(diffusion, 'blackRetention').description).toContain('glow 模式不要提供')
    const diffusionTint = property(diffusion, 'tint')
    expect(diffusionTint.additionalProperties).toBe(false)
    expect(property(diffusionTint, 'hue')).toMatchObject({ minimum: 0, maximum: 360 })
    expect(property(diffusionTint, 'lightness')).toMatchObject({ minimum: -1, maximum: 1 })

    const vgpuGlow = operationVariant(canonicalPreview?.aiInputSchema, 'vgpu_glow')
    expect(property(vgpuGlow, 'look').enum).toEqual(['natural', 'dreamy', 'neon'])
    expect(property(vgpuGlow, 'intensity')).toMatchObject({ minimum: 0, maximum: 1 })
    expect(property(vgpuGlow, 'tintEnabled').description).toContain('tintColor')
    expect(property(vgpuGlow, 'tintColor').pattern).toBe('^#[0-9a-fA-F]{6}$')
    const chromaticChannels = property(vgpuGlow, 'chromaticChannels')
    expect(Array.isArray(chromaticChannels.items)).toBe(true)
    expect(chromaticChannels.items).toHaveLength(2)
    expect((chromaticChannels.items as JsonRecord[]).every((item) => (
      Array.isArray(item.enum) && item.enum.join(',') === 'red,green,blue'
    ))).toBe(true)
  })

  it('运行时与 AI 契约都拒绝 operation 任意字段', () => {
    expect(canonicalPreview?.inputSchema.safeParse({
      sourceRef: { kind: 'asset', id: 'asset-1' },
      operations: [{ kind: 'vgpu_glow', arbitraryPatch: true }],
    }).success).toBe(false)
  })

  it.each([
    {
      label: '重复 crop',
      operations: [
        { kind: 'crop', crop: { x: 0, y: 0, width: 20, height: 20 } },
        { kind: 'crop', crop: { x: 1, y: 1, width: 10, height: 10 } },
      ],
      fix: 'crop 只能出现一次',
    },
    {
      label: '重复 blur',
      operations: [{ kind: 'blur', strength: 0.2 }, { kind: 'blur', strength: 0.7 }],
      fix: 'blur 只能出现一次',
    },
    {
      label: '重复 diffusion',
      operations: [{ kind: 'diffusion' }, { kind: 'diffusion', mode: 'glow' }],
      fix: 'diffusion 只能出现一次',
    },
    {
      label: '重复 vgpu_glow',
      operations: [{ kind: 'vgpu_glow' }, { kind: 'vgpu_glow', look: 'neon' }],
      fix: 'vgpu_glow 只能出现一次',
    },
    {
      label: '同时使用两种互斥光效',
      operations: [{ kind: 'diffusion' }, { kind: 'vgpu_glow' }],
      fix: '请选择并只保留一种光效',
    },
  ])('$label 时拒绝静默覆盖并直接说明改法', ({ operations, fix }) => {
    const parsed = canonicalPreview?.inputSchema.safeParse({
      sourceRef: { kind: 'asset', id: 'asset-1' },
      operations,
    })
    expect(parsed?.success).toBe(false)
    if (parsed && !parsed.success) {
      expect(parsed.error.issues.map((issue) => issue.message).join('\n')).toContain(fix)
    }
  })

  it('能力用可自我修正的信息拒绝静默失效参数', () => {
    const invalidMode = canonicalPreview?.inputSchema.safeParse({
      sourceRef: { kind: 'asset', id: 'asset-1' },
      operations: [{ kind: 'diffusion', mode: 'black_mist', glowExposure: 0.7 }],
    })
    expect(invalidMode?.success).toBe(false)
    if (invalidMode && !invalidMode.success) {
      expect(invalidMode.error.issues.map((issue) => issue.message).join('\n'))
        .toContain('请把 mode 改为 "glow"，或删除这些参数')
    }

    const invalidTint = canonicalPreview?.inputSchema.safeParse({
      sourceRef: { kind: 'asset', id: 'asset-1' },
      operations: [{
        kind: 'vgpu_glow',
        tintEnabled: false,
        tintColor: IMAGE_EDITOR_GLOW_TINT_HEX.neon,
      }],
    })
    expect(invalidTint?.success).toBe(false)
    if (invalidTint && !invalidTint.success) {
      expect(invalidTint.error.issues.map((issue) => issue.message).join('\n'))
        .toContain('请把 tintEnabled 改为 true，或删除 tintColor')
    }

    const inactiveChromaticChannels = canonicalPreview?.inputSchema.safeParse({
      sourceRef: { kind: 'asset', id: 'asset-1' },
      operations: [{ kind: 'vgpu_glow', chromaticChannels: ['green', 'blue'] }],
    })
    expect(inactiveChromaticChannels?.success).toBe(false)
    if (inactiveChromaticChannels && !inactiveChromaticChannels.success) {
      expect(inactiveChromaticChannels.error.issues.map((issue) => issue.message).join('\n'))
        .toContain('请提供大于 0 的 chromaticAberration，或删除 chromaticChannels')
    }
  })

  it('标注契约与正式编辑器字段、范围和联动保持一致', () => {
    const rect = markItemVariant(canonicalPreview?.aiInputSchema, 'rect')
    expect(property(rect, 'lineWidth').minimum).toBe(1)
    expect(property(rect, 'labelFontSize').minimum).toBe(8)
    expect(property(rect, 'stroke').pattern).toBe('^#[0-9a-fA-F]{6}$')
    expect(property(rect, 'labelBackgroundColor').pattern).toBe('^#[0-9a-fA-F]{6}$')

    const arrow = markItemVariant(canonicalPreview?.aiInputSchema, 'arrow')
    expect(property(arrow, 'curveControl')).toBeTruthy()

    const text = markItemVariant(canonicalPreview?.aiInputSchema, 'text')
    expect(property(text, 'fontSize').minimum).toBe(10)
    expect(property(text, 'backgroundColor').pattern).toBe('^#[0-9a-fA-F]{6}$')

    const pen = markItemVariant(canonicalPreview?.aiInputSchema, 'pen')
    expect(property(pen, 'points').maxItems).toBe(4_096)

    const mosaic = markItemVariant(canonicalPreview?.aiInputSchema, 'mosaic')
    expect(property(mosaic, 'strengthPercent')).toMatchObject({ minimum: 0.5, maximum: 8 })

    expect(canonicalPreview?.inputSchema.safeParse({
      sourceRef: { kind: 'asset', id: 'asset-1' },
      operations: [
        {
          kind: 'mark',
          item: {
            id: 'callout-1', type: 'rect', x: 1, y: 2, width: 30, height: 40,
            stroke: IMAGE_EDITOR_PRESET_COLORS[0], lineWidth: 1, label: '说明', labelFontSize: 8,
            labelDx: 4, labelDy: 5, labelBackgroundColor: BLACK_HEX,
          },
        },
        {
          kind: 'mark',
          item: {
            id: 'arrow-1', type: 'arrow', points: [1, 2, 30, 40],
            curveControl: [15, 8], stroke: IMAGE_EDITOR_PRESET_COLORS[3], lineWidth: 2,
          },
        },
        {
          kind: 'mark',
          item: {
            id: 'text-1', type: 'text', x: 2, y: 3, text: '文字',
            color: ANNOTATION_DEFAULT_TEXT_HEX, fontSize: 10, backgroundColor: BLACK_HEX,
          },
        },
      ],
    }).success).toBe(true)

    const invalidItems = [
      { type: 'rect', x: 1, y: 2, width: 3, height: 4, stroke: ANNOTATION_DEFAULT_STROKE_HEX, lineWidth: 0.5 },
      { type: 'text', x: 1, y: 2, text: '太小', color: ANNOTATION_DEFAULT_TEXT_HEX, fontSize: 9 },
      { type: 'mosaic', x: 1, y: 2, width: 3, height: 4, strengthPercent: 9 },
      { type: 'rect', x: 1, y: 2, width: 3, height: 4, stroke: ANNOTATION_DEFAULT_STROKE_HEX, lineWidth: 1, label: '偏移', labelDx: 2 },
      { type: 'rect', x: 1, y: 2, width: 3, height: 4, stroke: ANNOTATION_DEFAULT_STROKE_HEX, lineWidth: 1, labelBackgroundColor: BLACK_HEX },
      { type: 'text', x: 1, y: 2, text: '颜色', color: 'not-a-color', fontSize: 10 },
    ]
    for (const item of invalidItems) {
      expect(canonicalPreview?.inputSchema.safeParse({
        sourceRef: { kind: 'asset', id: 'asset-1' },
        operations: [{ kind: 'mark', item }],
      }).success, JSON.stringify(item)).toBe(false)
    }

    const duplicateIds = canonicalPreview?.inputSchema.safeParse({
      sourceRef: { kind: 'asset', id: 'asset-1' },
      operations: [
        { kind: 'mark', item: { id: 'same', type: 'text', x: 1, y: 2, text: '一', color: ANNOTATION_DEFAULT_TEXT_HEX, fontSize: 10 } },
        { kind: 'mark', item: { id: 'same', type: 'text', x: 3, y: 4, text: '二', color: ANNOTATION_DEFAULT_TEXT_HEX, fontSize: 10 } },
      ],
    })
    expect(duplicateIds?.success).toBe(false)
    if (duplicateIds && !duplicateIds.success) {
      expect(duplicateIds.error.issues.map((issue) => issue.message).join('\n'))
        .toContain('标注 id 不能重复')
    }
  })

  it('随机创建预览不冒充幂等或可撤销能力', () => {
    expect(canonicalPreview?.idempotent).toBe(false)
    expect(canonicalPreview?.supportsUndo).toBe(false)
  })

  it('成功结果提供结构化预览引用并生成精确 Effect', () => {
    const output = {
      previewRef: 'preview-1',
      sourceRef: { kind: 'asset', id: 'asset-1' },
      resultRefs: [{ kind: 'image_edit.preview' as const, id: 'preview-1' }] as const,
      operationCount: 1,
      hasEffect: true,
      width: 512,
      height: 512,
      revision: 1,
      scopeRevisions: {},
    }
    expect(canonicalPreview?.outputSchema.safeParse(output).success).toBe(true)
    expect(canonicalPreview?.resolveObservedEffects?.(
      { sourceRef: output.sourceRef, operations: [{ kind: 'rotate_cw' }] },
      output,
    )).toEqual([
      expect.objectContaining({
        effect: 'execute', targetRefs: [{ kind: 'image_edit.preview', id: 'preview-1' }],
      }),
      expect.objectContaining({
        effect: 'create', targetRefs: [{ kind: 'image_edit.preview', id: 'preview-1' }],
      }),
    ])
  })

  it('能力声明、返回引用与正式反射使用同一个预览实体名', () => {
    const reflectedEntityTypes = new Set(
      createImageEditReflectionRegistrations().map((registration) => registration.entity.id),
    )
    expect(canonicalPreview?.producesRefs).toEqual(['image_edit.preview'])
    for (const impact of canonicalPreview?.control.impacts ?? []) {
      for (const entityType of impact.entityTypes) {
        expect(reflectedEntityTypes.has(entityType), `${entityType} 未注册正式反射实体`).toBe(true)
      }
    }
    expect(reflectedEntityTypes.has('image_edit.session')).toBe(false)
  })
})
