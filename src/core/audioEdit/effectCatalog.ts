import { AUDIO_EFFECT_DEFINITIONS } from '../audio/effects/audioEffectDefinitions'
import { createAudioRackEffect } from '../audio/effects/rackEffect'
import { VIDEO_EDIT_BUILTIN_GROUP_NAMES, type VideoEditBuiltinGroup } from '../videoEdit/builtinEffects'
import { createAudioEditChainItem, type AudioEditChainItem } from './effects'
import type { AudioEditProcessorDescriptor } from './types'

/*
 * 音频编辑能加进效果控件的全部效果（效果控件的搜索与“效果”面板共用这一份）：
 * 智能修复（要整段分析或用本地模型）→ 内置效果（按 Audition 的分类）→ 第三方插件（按厂商）。
 */

export type AudioEditEffectFolder = 'smart' | 'builtin' | 'plugin'
export interface AudioEditEffectCatalogEntry {
  key: string
  name: string
  tooltip: string
  folder: AudioEditEffectFolder
  /** 文件夹下的分组（内置效果的分类、插件的厂商）。 */
  group: string
  groupName: string
  /** 同一效果在链里只该有一份（口水音、呼吸声）。 */
  single?: AudioEditChainItem['kind']
  disabledReason?: string
  create: () => AudioEditChainItem
}

export const AUDIO_EDIT_EFFECT_FOLDER_NAMES: Record<AudioEditEffectFolder, string> = { smart: '智能修复', builtin: '内置效果', plugin: '第三方插件' }

/** Audition 效果菜单的分类顺序。 */
const GROUP_ORDER: readonly string[] = ['audio_level', 'audio_dynamics', 'audio_eq', 'audio_repair', 'audio_space', 'audio_delay', 'audio_modulation', 'audio_stereo', 'audio_special', 'audio_pitch']

const SMART: AudioEditEffectCatalogEntry[] = [
  { key: 'mouth_declick', name: '去除口水音', tooltip: '找出说话时口水带出的“咔啦”声，按前后声音插值修掉，不改变时长。加进来就按它之前的声音自动检测。', folder: 'smart', group: 'repair', groupName: '修复', single: 'mouth_declick', create: () => createAudioEditChainItem('mouth_declick') },
  { key: 'breath', name: '呼吸声', tooltip: '把检测到的呼吸统一减弱或静音，不改变时长；要删掉呼吸（缩短时长）用文字稿里的“自动粗剪”。第一次使用会下载约 13 MB 的本地模型。', folder: 'smart', group: 'repair', groupName: '修复', single: 'breath', create: () => createAudioEditChainItem('breath') },
  { key: 'separation:dereverb', name: '去混响', tooltip: '去掉房间回声，让声音更干、更靠前。用本地模型整段处理（第一次使用下载约 67 MB）。', folder: 'smart', group: 'repair', groupName: '修复', create: () => createAudioEditChainItem('separation', { mode: 'dereverb' }) },
  { key: 'separation:isolate', name: '人声分离', tooltip: '只保留人声，去掉背景音乐和环境声。用本地模型整段处理（第一次使用下载约 67 MB）。', folder: 'smart', group: 'repair', groupName: '修复', create: () => createAudioEditChainItem('separation', { mode: 'isolate' }) },
  { key: 'essential', name: '基本声音', tooltip: '按声音类型（对话、音乐…）一键处理：去低频、降噪、齿音、动态、均衡、增强语音和混响，像 Audition 的“基本声音”。', folder: 'smart', group: 'preset', groupName: '一键处理', create: () => createAudioEditChainItem('essential') },
]

export function audioEditEffectCatalog(plugins: readonly AudioEditProcessorDescriptor[]): AudioEditEffectCatalogEntry[] {
  const builtins = [...AUDIO_EFFECT_DEFINITIONS]
    .sort((a, b) => GROUP_ORDER.indexOf(a.group as string) - GROUP_ORDER.indexOf(b.group as string))
    .map((definition): AudioEditEffectCatalogEntry => ({
      key: `builtin:${definition.id}`, name: definition.name, tooltip: definition.tooltip, folder: 'builtin',
      group: definition.group as string, groupName: VIDEO_EDIT_BUILTIN_GROUP_NAMES[definition.group as VideoEditBuiltinGroup] ?? '其他',
      create: () => ({ ...createAudioRackEffect(definition), kind: 'builtin' }),
    }))
  const external = [...plugins].sort((a, b) => a.vendor.localeCompare(b.vendor) || a.name.localeCompare(b.name)).map((plugin): AudioEditEffectCatalogEntry => ({
    key: `plugin:${plugin.id}`, name: plugin.name, tooltip: `${plugin.vendor} · ${plugin.version}`, folder: 'plugin', group: plugin.vendor, groupName: plugin.vendor,
    ...(plugin.available ? {} : { disabledReason: plugin.reason ?? '这个插件现在还不能加载。' }),
    create: () => ({ id: crypto.randomUUID(), kind: 'plugin', name: plugin.name, enabled: true, pluginId: plugin.id, parameters: {} }),
  }))
  return [...SMART, ...builtins, ...external]
}

/** 按名称、说明与分组搜索（不区分大小写）。 */
export function filterAudioEditEffectCatalog(entries: readonly AudioEditEffectCatalogEntry[], query: string): AudioEditEffectCatalogEntry[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return [...entries]
  return entries.filter(entry => entry.name.toLowerCase().includes(needle) || entry.tooltip.toLowerCase().includes(needle) || entry.groupName.toLowerCase().includes(needle))
}

/** 效果项在界面上的名称（插件优先用目录里的真实名称）。 */
export function audioEditChainItemName(item: AudioEditChainItem, plugins: readonly AudioEditProcessorDescriptor[] = []): string {
  switch (item.kind) {
    case 'builtin': return item.name
    case 'essential': return '基本声音'
    case 'mouth_declick': return '去除口水音'
    case 'breath': return '呼吸声'
    case 'separation': return item.mode === 'isolate' ? '人声分离' : '去混响'
    case 'plugin': return plugins.find(plugin => plugin.id === item.pluginId)?.name ?? item.name
  }
}
