// @vitest-environment jsdom
import React from 'react'
import { render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'

vi.mock('@/core/types/settingsDeclaration', async importOriginal => {
  const actual = await importOriginal<typeof import('@/core/types/settingsDeclaration')>()
  return { ...actual, SETTINGS_DECLARATION: { ...actual.SETTINGS_DECLARATION,
    assistant: { ...actual.SETTINGS_DECLARATION.assistant, sections: [
      ...actual.SETTINGS_DECLARATION.assistant.sections,
      { id: 'assistant-extra', componentKeys: ['AssistantMemorySection'], titleKey: 'navSections.assistant-extra',
        surfaceId: 'settings.assistant.extra', surfaceOrder: 100, schemaOrder: 100 },
    ] },
  } }
})
vi.mock('./SettingsSection', () => ({ default: ({ id, children }: { id: string; children: React.ReactNode }) => (
  <section data-testid={id}>{children}</section>
) }))
vi.mock('../tabs/settingsSectionComponents', () => {
  const Empty = () => null
  return { SETTINGS_SECTION_COMPONENTS: { AssistantModelsSection: Empty, AgentUserInstructionsSection: Empty,
    PaidApprovalSection: Empty, AssistantMemorySection: () => <span>记忆内容</span>, McpSection: Empty } }
})

import { SETTINGS_DECLARATION } from '@/core/types/settingsDeclaration'
import { SettingsTabSections } from './SettingsTabSections'

it('只在声明增加复用组件的分区，Tab 无需补写分区即可实际渲染', () => {
  render(<SettingsTabSections tab="assistant" />)
  expect(screen.getByTestId('assistant-extra').textContent).toBe('记忆内容')
  expect(screen.getAllByTestId(/^assistant-/).map(node => node.dataset.testid))
    .toEqual(SETTINGS_DECLARATION.assistant.sections.map(section => section.id))
})
