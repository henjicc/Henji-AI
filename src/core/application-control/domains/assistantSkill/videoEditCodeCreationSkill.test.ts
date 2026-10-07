import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { BUILTIN_APPLICATION_CAPABILITY_REGISTRY } from '@/core/application-control/builtinApplicationCapabilityRegistry'
import { CODE_BUILTINS, CODE_CONTEXT_KEYS } from '@/core/videoEdit/codeMaterial/contract'
import { createVideoEditRegistrations } from '@/features/videoEdit/application/videoEditReflection'
import { PROTOCOL_TOOL_SPECS } from '../../../../../electron/main/services/application-runtime/toolCatalog'

/**
 * 运行时技能 video-edit-code-creation 的正文是给模型照做的操作说明，写错一个工具名或属性 ID，
 * 模型就会照着错的去调用。这里从正式注册表、能力目录和作者编译器反向核对技能文本，
 * 让领域改名或删字段时技能当场变红，而不是等真实会话撞墙。
 */
const SKILL_DIR = path.resolve('resources/assistant-skills/video-edit-code-creation')
const files = [path.join(SKILL_DIR, 'SKILL.md'), ...fs.readdirSync(path.join(SKILL_DIR, 'references')).map(name => path.join(SKILL_DIR, 'references', name))]
const text = (file: string): string => fs.readFileSync(file, 'utf8')
const all = files.map(text).join('\n')
const registrations = createVideoEditRegistrations()
const entityTypes = new Set(registrations.map(registration => registration.entity.id))
const properties = new Map(registrations.flatMap(registration => registration.properties.map(property => [property.id, { entityType: registration.entity.id, property }] as const)))
// load_application_tools 是内置 Pi 的披露工具，不在应用能力目录里；create_items/set_properties 是事务变更种类。
const piDisclosureSource = fs.readFileSync(path.resolve('electron/main/services/embedded-agent/toolDisclosure.ts'), 'utf8')
const knownNames = new Set([
  ...BUILTIN_APPLICATION_CAPABILITY_REGISTRY.list().map(definition => definition.id),
  ...PROTOCOL_TOOL_SPECS.map(spec => spec.name),
  ...(piDisclosureSource.includes("name: 'load_application_tools'") ? ['load_application_tools'] : []),
  'create_items', 'set_properties', 'remove_items', 'mutate_properties',
])
function blocks(language: 'json'): string[] {
  return [...text(path.join(SKILL_DIR, 'references/examples.md')).matchAll(new RegExp('```' + language + '\\r?\\n([\\s\\S]*?)```', 'g'))].map(match => match[1])
}

describe('剪辑代码素材技能只引用真实契约', () => {
  it('提到的工具、事务种类、实体类型与属性都存在于正式目录', () => {
    const names = [...new Set([...all.matchAll(/`([a-z]+(?:_[a-z]+)+)`/g)].map(match => match[1]))]
    expect(names.length).toBeGreaterThan(8)
    expect(names.filter(name => !knownNames.has(name))).toEqual([])
    const ids = [...new Set([...all.matchAll(/video_edit\.[a-z_]+(?:\.[a-z_]+)?/g)].map(match => match[0]))]
    const unknown = ids.filter(id => !entityTypes.has(id) && !properties.has(id))
    expect(unknown).toEqual([])
    expect(ids.filter(id => properties.has(id)).length).toBeGreaterThan(20)
  })

  it('作者接口包含基础 ctx 与内置函数，v3 扩展按职责分流', () => {
    const api = text(path.join(SKILL_DIR, 'references/author-api.md'))
    const motion = text(path.join(SKILL_DIR, 'references/author-text-motion.md'))
    const shaders = text(path.join(SKILL_DIR, 'references/author-shaders.md'))
    for (const key of CODE_CONTEXT_KEYS) expect(api).toContain(key)
    for (const name of CODE_BUILTINS) expect([api, motion, shaders].join('\n')).toContain(name)
    expect(api).toContain('languageVersion: 3')
    expect(motion).toContain('perChar')
    expect(shaders).toContain('shaderFilter')
  })

  it('全部样例调用满足正式事务 schema、可写属性与集合必填契约', () => {
    // 源码编译、多个源时刻与调参求值由 skillExamples.test.ts 直接读取 Markdown 验证。
    const payloads = blocks('json').map(raw => JSON.parse(raw) as {
      changes: Array<{ kind: string; entityType: string; properties?: Record<string, unknown>; items?: Array<{ properties: Record<string, unknown> }> }>
    })
    expect(payloads).toHaveLength(8)
    const change = BUILTIN_APPLICATION_CAPABILITY_REGISTRY.get('change_application_entities')!
    for (const payload of payloads) {
      expect(change.inputSchema.safeParse(payload).success).toBe(true)
      for (const step of payload.changes) {
        const registration = registrations.find(item => item.entity.id === step.entityType)!
        const dictionaries = step.kind === 'create_items' ? step.items!.map(item => item.properties) : [step.properties!]
        if (step.kind === 'create_items') expect(registration.entity.collectionWrite?.creatable).toBe(true)
        for (const dictionary of dictionaries) {
          if (step.kind === 'create_items') {
            for (const required of registration.entity.collectionWrite!.requiredPropertyIds) expect(dictionary).toHaveProperty([required])
          }
          for (const id of Object.keys(dictionary)) {
            const found = properties.get(id)
            expect(found?.entityType, id).toBe(step.entityType)
            const writable = !found!.property.readOnlyReason && found!.property.requiredPermissions.write.length > 0
            expect(writable || step.kind === 'create_items' && registration.entity.collectionWrite!.requiredPropertyIds.includes(id), id).toBe(true)
          }
        }
      }
    }
  })

  it('主文件与每份参考保持有界，主文件链接与实际参考一致', () => {
    const main = text(path.join(SKILL_DIR, 'SKILL.md'))
    expect(Buffer.byteLength(main, 'utf8')).toBeLessThanOrEqual(6 * 1024)
    const links = [...main.matchAll(/\]\((references\/[^)]+)\)/g)].map(match => match[1]).sort()
    expect(links).toEqual(fs.readdirSync(path.join(SKILL_DIR, 'references')).map(name => `references/${name}`).sort())
    for (const file of files.slice(1)) {
      const limit = path.basename(file) === 'examples.md' ? 16 * 1024 : 8 * 1024
      expect(Buffer.byteLength(text(file), 'utf8'), file).toBeLessThanOrEqual(limit)
    }
  })
})
