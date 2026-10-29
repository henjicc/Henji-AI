import { expect, it } from 'vitest'
import { deriveSettingsRegistration } from './settingsNavigation'
import { SETTINGS_DECLARATION } from './settingsDeclaration'

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
