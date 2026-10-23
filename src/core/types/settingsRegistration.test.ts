import { createHash } from 'node:crypto'
import { expect, it } from 'vitest'
import { deriveSettingsRegistration, SETTINGS_TAB_SECTIONS } from './settingsNavigation'
import { SETTINGS_DECLARATION } from './settingsDeclaration'
import { APPLICATION_SURFACE_IDS } from '../application-control/applicationSurfaces'
import { APPLICATION_SURFACE_DEFINITIONS } from '../../features/navigation/application/surfaceCatalog'
import { SETTINGS_SEARCH_INDEX } from '../../components/Settings/settingsSearchIndex'

function normalize(value: unknown): unknown {
  return Array.isArray(value) ? value.map(normalize)
    : value && typeof value === 'object'
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b, 'en')).map(([key, item]) => [key, normalize(item)]))
      : value
}

it('保留设置导航、Surface 与搜索的现有顺序和内容', () => {
  const value = { navigation: SETTINGS_TAB_SECTIONS, ids: APPLICATION_SURFACE_IDS,
    surfaces: APPLICATION_SURFACE_DEFINITIONS, search: SETTINGS_SEARCH_INDEX }
  const hash = createHash('sha256').update(JSON.stringify(normalize(value))).digest('hex')
  // ba18f9b88 的正式导出值；只规范对象键，不排序任何数组。
  expect(hash).toBe('349bfd78e867a0e7bd017c9630a85757e84aa1318816876e040285996d70d014')
})

it('只增一条分区声明即可生成导航、组件次序、Surface、标题搜索和属性目标', () => {
  const extra = { id: 'assistant-example', surfaceId: 'settings.assistant.example',
    componentKeys: ['AssistantMemorySection'], titleKey: 'navSections.assistant-example', surfaceOrder: 100, schemaOrder: 100 } as const
  const projected = deriveSettingsRegistration({ ...SETTINGS_DECLARATION,
    assistant: { ...SETTINGS_DECLARATION.assistant, sections: [...SETTINGS_DECLARATION.assistant.sections, extra] } })
  expect(projected.tabSections.assistant.at(-1)).toBe(extra.id)
  expect(projected.sections.at(-2)).toMatchObject({ ...extra, tab: 'assistant' })
  expect(projected.surfaceIds).toContain(extra.surfaceId)
  expect(projected.surfaces.at(-1)).toMatchObject({ id: extra.surfaceId,
    settingsTarget: { tab: 'assistant', sectionId: extra.id } })
  expect(projected.search.at(-1)).toEqual({ sectionId: extra.id, labelKey: extra.titleKey })
})
