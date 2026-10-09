import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { BUILTIN_APPLICATION_CAPABILITY_REGISTRY } from '../../builtinApplicationCapabilityRegistry'
import { APPLICATION_READABLE_MEDIA_KINDS } from '../../mediaReferenceKinds'
import { imageColorGradeParamsSchema } from '../../../imaging/adjustments/schema'
import { imageEditSelectionSessionSchemaV3 } from '../../../imageEdit/v3/selection/session'
import { createImageEditReflectionRegistrations } from '../../../../features/imageEdit/application/imageEditReflection'
import { createLocalModelRegistrations } from '../../../../features/localModels/application/localModelsReflection'
import { PROTOCOL_TOOL_SPECS } from '../../../../../electron/main/services/application-runtime/toolCatalog'

const skillDirectory = path.resolve('resources/assistant-skills/image-edit-workbench')
const referencePaths = fs.readdirSync(path.join(skillDirectory, 'references')).map(name => `references/${name}`).sort()
const files = ['SKILL.md', ...referencePaths].map(relativePath => ({
  relativePath, content: fs.readFileSync(path.join(skillDirectory, relativePath), 'utf8'),
}))
const all = files.map(file => file.content).join('\n')
const registrations = [...createImageEditReflectionRegistrations(), ...createLocalModelRegistrations()]
const definitions = BUILTIN_APPLICATION_CAPABILITY_REGISTRY.list()
const entityIds = new Set([
  ...registrations.map(registration => registration.entity.id),
  ...definitions.flatMap(definition => [...definition.acceptsRefs, ...definition.producesRefs]),
])
const propertyIds = new Set(registrations.flatMap(registration => registration.properties.map(property => property.id)))
const disclosure = fs.readFileSync(path.resolve('electron/main/services/embedded-agent/toolDisclosure.ts'), 'utf8')
const knownNames = new Set([
  ...definitions.map(definition => definition.id),
  ...PROTOCOL_TOOL_SPECS.map(spec => spec.name),
  ...(disclosure.includes("name: 'load_application_tools'") ? ['load_application_tools'] : []),
  'create_items', 'set_properties', 'remove_items',
])

function unknownIds(content: string): string[] {
  const ids = [...new Set([...content.matchAll(/\b(?:image_edit|local_model|documents|canvas)\.[a-z_]+(?:\.[a-z_]+)*/g)].map(match => match[0]))]
  return ids.filter(id => !entityIds.has(id) && !propertyIds.has(id))
}

describe('图片编辑工作台技能的渐进披露与真实契约', () => {
  it('正文及参考中的工具、事务种类与完整实体/属性ID来自正式目录', () => {
    const names = [...new Set([...all.matchAll(/`([a-z]+(?:_[a-z]+)+)`/g)].map(match => match[1]))]
    expect(names.length).toBeGreaterThan(15)
    expect(names.filter(name => !knownNames.has(name))).toEqual([])
    expect(unknownIds(all)).toEqual([])
    expect(unknownIds('image_edit.layer.invented local_model.item.fake')).toEqual(['image_edit.layer.invented', 'local_model.item.fake'])
    for (const id of ['select_image_edit_region', 'apply_image_edit_selection', 'remove_image_edit_region', 'repair_image_edit_region']) {
      expect(names).toContain(id)
      expect(BUILTIN_APPLICATION_CAPABILITY_REGISTRY.get(id)?.supportsUndo).toBe(true)
    }
  })

  it('JSON样例通过正式工具schema，通用写入中的参数与选区也通过领域schema', () => {
    const examples = files.flatMap(file => [...file.content.matchAll(/```json\r?\n([\s\S]*?)```/g)].map(match => ({ file: file.relativePath, raw: match[1] })))
    expect(examples).toHaveLength(5)
    const collection = registrations.find(registration => registration.entity.id === 'image_edit.layer')!.entity.collectionWrite!
    for (const example of examples) {
      const call = JSON.parse(example.raw) as { tool: string; input: Record<string, unknown> }
      expect(Object.keys(call).sort(), example.file).toEqual(['input', 'tool'])
      const definition = BUILTIN_APPLICATION_CAPABILITY_REGISTRY.get(call.tool)
      expect(definition, `${example.file}: ${call.tool}`).toBeDefined()
      const parsed = definition!.inputSchema.safeParse(call.input)
      expect(parsed.success, `${example.file}: ${JSON.stringify(parsed.success ? null : parsed.error.issues)}`).toBe(true)
      if (call.tool !== 'change_application_entities') continue
      const changes = call.input.changes as Array<{ kind: string; entityType: string; properties?: Record<string, unknown>; items?: Array<{ properties: Record<string, unknown> }> }>
      for (const change of changes) {
        expect(entityIds.has(change.entityType)).toBe(true)
        const properties = change.properties ?? change.items![0].properties
        expect(Object.keys(properties).filter(id => !propertyIds.has(id))).toEqual([])
        if (change.kind === 'create_items') expect(Object.keys(properties)).toEqual(expect.arrayContaining(collection.requiredPropertyIds))
        if ('image_edit.layer.params' in properties) expect(imageColorGradeParamsSchema.safeParse(properties['image_edit.layer.params']).success).toBe(true)
        if ('image_edit.selection.region' in properties) expect(imageEditSelectionSessionSchemaV3.safeParse(properties['image_edit.selection.region']).success).toBe(true)
      }
    }
    const parameterNames = [...all.matchAll(/params\.([a-z_]+)/g)].map(match => match[1])
    expect(parameterNames.filter(name => name !== 'hsl_show_mask' && !(name in imageColorGradeParamsSchema.shape))).toEqual([])
    expect(imageColorGradeParamsSchema.safeParse({ hsl_show_mask: true }).success).toBe(false)
    expect(imageEditSelectionSessionSchemaV3.safeParse({ operations: [], feather: 2, inverted: false }).success).toBe(false)
  })

  it('入口与四篇链接有界、首轮不带参数细节并明确技能分工', () => {
    const main = files[0].content
    expect(main).toMatch(/^---\r?\nname: image-edit-workbench\r?\ndescription: .+\r?\n---/)
    const description = /^description: (.+)$/m.exec(main)![1]
    expect(description.length).toBeLessThanOrEqual(200)
    for (const trigger of ['修图', '调色', '主体', '移除物体', '修补瑕疵', '图层与蒙版', '导出图片', 'video-edit-workbench', 'video-edit-code-creation']) expect(description).toContain(trigger)
    expect(main).toContain('本技能给起点与判断依据，不规定风格，用户简报和偏好优先')
    expect(main).not.toContain('params.exposure')
    expect(Buffer.byteLength(main, 'utf8')).toBeLessThanOrEqual(6144)
    expect(referencePaths).toEqual(['references/adjust.md', 'references/layers-export.md', 'references/repair.md', 'references/select.md'])
    expect([...main.matchAll(/\]\((references\/[^)]+)\)/g)].map(match => match[1]).filter((link, index, links) => links.indexOf(link) === index).sort()).toEqual(referencePaths)
    for (const file of files.slice(1)) {
      expect(file.content).toMatch(/^# .+\r?\n\r?\n> 何时读：/)
      expect(Buffer.byteLength(file.content, 'utf8'), file.relativePath).toBeLessThanOrEqual(8 * 1024)
    }
  })

  it('不把工作文档当可读媒体，不把候选或已提交状态当视觉/画质验收', () => {
    expect(APPLICATION_READABLE_MEDIA_KINDS).not.toContain('image_edit.document')
    expect(BUILTIN_APPLICATION_CAPABILITY_REGISTRY.get('observe_application_surface')?.external?.kind).toBe('internal')
    expect(all).toContain('外部 MCP 不开放该截图')
    expect(all).toContain('未做视觉验证')
    expect(all).toContain('status=candidates 只返回候选、不改选区')
    expect(all).toContain('候选过期，重新识别')
    expect(all).toContain('公开目录没有 V3 图片专用撤销工具')
    expect(all).toContain('只收创建预览返回的previewRef')
    expect(all).toContain('轻微错位')
    expect(all).toContain('不代替用户批准')
    expect(all).toContain('取消识别只丢本次迟到结果，不擅停共享下载')
  })
})
