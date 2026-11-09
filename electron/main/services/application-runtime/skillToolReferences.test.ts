import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { BUILTIN_APPLICATION_CAPABILITY_REGISTRY } from '../../../../src/core/application-control/builtinApplicationCapabilityRegistry'
import { PROTOCOL_TOOL_SPECS } from './toolCatalog'
import { AGENT_SKILL_NAMES } from '../assistant/skills/agentSkills'
import { domainProfiles } from '../embedded-agent/toolDisclosureProfiles'

const skillsRoot = path.resolve('resources/assistant-skills')
const TOOL_VERBS = new Set(['list', 'get', 'read', 'create', 'update', 'delete', 'remove', 'run', 'query', 'discover', 'describe', 'apply', 'generate', 'prepare', 'submit', 'load', 'set', 'search', 'open', 'close', 'focus', 'import', 'export', 'wait', 'cancel', 'retry', 'resolve', 'organize', 'revert', 'undo', 'redo', 'change', 'tidy', 'observe', 'compose', 'place', 'render', 'track', 'start', 'stop', 'pause', 'resume', 'add', 'select', 'send', 'clear', 'collect', 'commit', 'detect', 'analyze', 'process', 'interpret', 'block', 'follow', 'cover', 'check', 'verify', 'duplicate', 'insert', 'split', 'trim', 'nest', 'transcribe', 'translate', 'segment', 'match', 'normalize', 'measure', 'stabilize', 'ramp', 'ripple', 'restore', 'paint', 'repair', 'compute', 'use', 'bind', 'promote', 'detach', 'upgrade', 'migrate', 'register', 'mark', 'record', 'replay', 'understand', 'plan', 'edit', 'extract', 'auto', 'arrange', 'transition', 'stagger', 'remix', 'quick', 'format', 'compress', 'clean', 'reset', 'save', 'connect', 'disconnect', 'group', 'ungroup', 'download', 'review', 'rerecord', 'redub', 'fetch', 'move', 'switch', 'cut', 'resample', 'inspect', 'navigate', 'show', 'find', 'toggle', 'rename', 'write', 'append', 'copy', 'paste', 'play', 'seek'])

function markdownFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name)
    return entry.isDirectory() ? markdownFiles(full) : entry.name.endsWith('.md') ? [full] : []
  })
}

/*
 * 技能文档会在能力改名、删除后继续教旧工具：图片生成与生成排障曾一直在教已删除的
 * run_henji_script、discover_application_capabilities 与 query_diagnostic_events，助手照做只会走弯路。
 * 这里把所有技能里写成 `snake_case` 工具名的地方与正式能力目录对一遍。
 */
describe('全部助手技能只引用真实存在的工具', () => {
  it('技能里提到的工具名都在能力目录里', () => {
    const ids = new Set(BUILTIN_APPLICATION_CAPABILITY_REGISTRY.list().map((definition) => definition.id))
    // 协议层工具（发现、操作核对、读媒体）与内置助手宿主工具不在应用能力目录里；
    // correct_same_model_parameters 是失败恢复策略的取值，不是工具
    const hostTools = new Set([...PROTOCOL_TOOL_SPECS.map((spec) => spec.name), 'load_application_tools', 'load_assistant_skill', 'read_assistant_context', 'correct_same_model_parameters',
      // change_application_entities 的变更种类与镜头剪辑规则名，不是工具
      'create_items', 'remove_items', 'set_properties', 'cut_on_action'])
    const missing = markdownFiles(skillsRoot).flatMap((file) => {
      const content = fs.readFileSync(file, 'utf8')
      return [...content.matchAll(/`([a-z]+(?:_[a-z]+){1,})`/g)]
        .map((match) => match[1])
        // 工具名动词开头；属性键、规则名（space_cast_shadow、cut_on_action）不是工具
        .filter((name) => TOOL_VERBS.has(name.split('_')[0]))
        .filter((name) => !ids.has(name) && !hostTools.has(name))
        .map((name) => `${path.relative(skillsRoot, file)}: ${name}`)
    })
    expect([...new Set(missing)]).toEqual([])
  })

  // 加载领域工具时指给模型的技能和工具改名或删掉后，提示会把它引向不存在的东西
  it('按领域加载时指向的技能与工具都真实存在', () => {
    const ids = new Set(BUILTIN_APPLICATION_CAPABILITY_REGISTRY.list().map((definition) => definition.id))
    for (const [domain, profile] of Object.entries(domainProfiles)) {
      expect(AGENT_SKILL_NAMES.has(profile.skill), domain).toBe(true)
      expect(profile.guidance).toContain(`「${profile.skill}」`)
      const named = [...profile.tools, ...[...profile.guidance.matchAll(/\b([a-z]+(?:_[a-z]+){2,})\b/g)].map((match) => match[1])]
      expect(named.filter((name) => !ids.has(name) && name !== 'load_assistant_skill'), domain).toEqual([])
    }
  })
})
