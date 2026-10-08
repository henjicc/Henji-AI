import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { BUILTIN_APPLICATION_CAPABILITY_REGISTRY } from '@/core/application-control/builtinApplicationCapabilityRegistry'
import { createVideoEditRegistrations } from '@/features/videoEdit/application/videoEditReflection'
import { PROTOCOL_TOOL_SPECS } from '../../../../../electron/main/services/application-runtime/toolCatalog'

const skillDirectory = path.resolve('resources/assistant-skills/video-edit-workbench')
const referencePaths = fs.readdirSync(path.join(skillDirectory, 'references')).map(name => `references/${name}`).sort()
const files = ['SKILL.md', ...referencePaths].map(relativePath => ({
  relativePath, content: fs.readFileSync(path.join(skillDirectory, relativePath), 'utf8'),
}))
const all = files.map(file => file.content).join('\n')
const registrations = createVideoEditRegistrations()
const entityIds = new Set(registrations.map(registration => registration.entity.id))
const propertyIds = new Set(registrations.flatMap(registration => registration.properties.map(property => property.id)))
const disclosure = fs.readFileSync(path.resolve('electron/main/services/embedded-agent/toolDisclosure.ts'), 'utf8')
const knownNames = new Set([
  ...BUILTIN_APPLICATION_CAPABILITY_REGISTRY.list().map(definition => definition.id),
  ...PROTOCOL_TOOL_SPECS.map(spec => spec.name),
  ...(disclosure.includes("name: 'load_application_tools'") ? ['load_application_tools'] : []),
  'create_items', 'set_properties', 'remove_items', 'mutate_properties',
])

describe('剪辑工作台技能的操作说明与正式契约保持一致', () => {
  it('全部工具、事务种类与完整实体/属性ID都能从正式目录发现', () => {
    const names = [...new Set([...all.matchAll(/`([a-z]+(?:_[a-z]+)+)`/g)].map(match => match[1]))]
    expect(names.length).toBeGreaterThan(30)
    expect(names.filter(name => !knownNames.has(name))).toEqual([])
    // 包含 volume.keyframes 等多级属性，不只检查到第二个点号。
    const ids = [...new Set([...all.matchAll(/video_edit\.[a-z_]+(?:\.[a-z_]+)*/g)].map(match => match[0]))]
    expect(ids.filter(id => !entityIds.has(id) && !propertyIds.has(id))).toEqual([])
    expect(ids.filter(id => propertyIds.has(id)).length).toBeGreaterThan(30)
  })

  it('每份JSON调用样例都使用对应能力的正式输入schema', () => {
    const examples = files.flatMap(file => [...file.content.matchAll(/```json\r?\n([\s\S]*?)```/g)].map(match => ({ file: file.relativePath, raw: match[1] })))
    expect(examples.length).toBeGreaterThan(0)
    for (const example of examples) {
      const call = JSON.parse(example.raw) as { tool: string; input: unknown }
      expect(Object.keys(call).sort(), example.file).toEqual(['input', 'tool'])
      const definition = BUILTIN_APPLICATION_CAPABILITY_REGISTRY.get(call.tool)
      expect(definition, `${example.file}: ${call.tool}`).toBeDefined()
      const result = definition!.inputSchema.safeParse(call.input)
      expect(result.success, `${example.file}: ${JSON.stringify(result.success ? null : result.error.issues)}`).toBe(true)
    }
  })

  it('主文件链接完整、每篇先说明何时读且按需加载内容有界', () => {
    const main = files[0].content
    expect(main).toMatch(/^---\r?\nname: video-edit-workbench\r?\ndescription: .+\r?\n---/)
    expect(Buffer.byteLength(main, 'utf8')).toBeLessThanOrEqual(6144)
    const links = [...main.matchAll(/\]\((references\/[^)]+)\)/g)].map(match => match[1]).sort()
    expect(links).toEqual(referencePaths)
    for (const file of files.slice(1)) {
      expect(file.content).toMatch(/^# .+\r?\n\r?\n> 何时读：/)
      expect(Buffer.byteLength(file.content, 'utf8'), file.relativePath).toBeLessThanOrEqual(8 * 1024)
    }
  })
})
