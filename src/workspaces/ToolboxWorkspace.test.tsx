// @vitest-environment jsdom
import { lazy } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TOOL_DESCRIPTORS } from '@/core/toolbox/toolCatalog'
import { useNavigationStore } from '@/stores/navigationStore'
import i18n from '@/i18n'
import ui from '@/i18n/locales/zh-CN/ui.json'

vi.mock('@/contexts/NotificationContext', () => ({ useNotification: () => ({ showNotification: vi.fn() }) }))
vi.mock('@/features/toolbox/toolboxRecentFiles', () => ({
  TOOLBOX_RECENT_FILE_LIMIT: 5,
  loadToolboxRecentFiles: async () => [],
  openToolboxRecentFile: vi.fn(),
}))
vi.mock('./toolboxRuntime', async () => {
  const { TOOL_DESCRIPTORS: tools } = await import('@/core/toolbox/toolCatalog')
  const { ICON_TOOL_IMAGE_EDIT: icon } = await import('@/core/theme/icons')
  const { createElement } = await import('react')
  return { TOOLBOX_RUNTIME: tools.map((descriptor) => ({
    descriptor, icon,
    component: lazy(async () => ({ default: ({ onBack }: { onBack: () => void }) =>
      createElement('button', { onClick: onBack }, `工作面 ${descriptor.id}`) })),
  })) }
})
import ToolboxWorkspace from './ToolboxWorkspace'

beforeEach(async () => {
  await i18n.changeLanguage('zh-CN')
  useNavigationStore.setState({ activeWorkspace: 'tools', activeToolId: null })
})
afterEach(cleanup)

describe('ToolboxWorkspace 登记驱动', () => {
  it('首页按登记顺序使用原有中文标题与描述', async () => {
    render(<ToolboxWorkspace />)
    const cards = screen.getAllByRole('button')
    expect(cards).toHaveLength(TOOL_DESCRIPTORS.length)
    TOOL_DESCRIPTORS.forEach((tool, index) => {
      const text = ui.toolbox[tool.id]
      expect(cards[index].textContent).toContain(text.title)
      expect(cards[index].textContent).toContain(text.description)
    })
    fireEvent.click(cards[0])
    expect(useNavigationStore.getState().activeToolId).toBe(TOOL_DESCRIPTORS[0].id)
    expect(await screen.findByText(`工作面 ${TOOL_DESCRIPTORS[0].id}`)).toBeTruthy()
  })

  it.each(TOOL_DESCRIPTORS)('$id 加载对应工作面、标注 Surface，统一返回首页', async (tool) => {
    useNavigationStore.setState({ activeToolId: tool.id })
    const { container } = render(<ToolboxWorkspace />)
    const back = await screen.findByText(`工作面 ${tool.id}`)
    expect(container.querySelector('[data-application-surface-id]')?.getAttribute('data-application-surface-id')).toBe(tool.surfaceId)
    fireEvent.click(back)
    expect(useNavigationStore.getState().activeToolId).toBeNull()
    expect(screen.getByText(ui.toolbox[tool.id].title)).toBeTruthy()
  })
})
