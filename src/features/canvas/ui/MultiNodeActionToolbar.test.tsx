/** @vitest-environment jsdom */

import { cleanup, render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CanvasNode } from '../domain/canvasNodes'
import { MultiNodeActionToolbar } from './MultiNodeActionToolbar'

vi.mock('@xyflow/react', () => ({
  Position: { Top: 'top' },
  NodeToolbar: ({ nodeId, children }: { nodeId: string[]; children: ReactNode }) => (
    <div data-toolbar-node-ids={nodeId.join(',')}>{children}</div>
  ),
}))
vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>()
  return {
    ...actual,
    useTranslation: () => ({ t: (key: string, values?: { count?: number }) =>
      key === 'nodeToolbar.batchDownload' ? `下载 ${values?.count} 项` : key }),
  }
})
vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: (selector: (state: { downloadPresetPaths: string[] }) => unknown) =>
    selector({ downloadPresetPaths: [] }),
}))
vi.mock('@/features/canvas/hooks/useNodeDownload', () => ({
  useNodeDownload: () => ({
    canDownload: true,
    downloadCount: 2,
    downloadMenu: null,
    isDownloadMenuVisible: false,
    downloadMenuRef: { current: null },
    handleDownloadClick: vi.fn(),
    handleDownloadSaveAs: vi.fn(),
    handleDownloadToPreset: vi.fn(),
  }),
}))

afterEach(() => cleanup())

describe('MultiNodeActionToolbar', () => {
  it('绑定整组节点并显示实际可下载数量', () => {
    const nodes = [
      { id: 'node-1' },
      { id: 'node-2' },
      { id: 'node-3' },
    ] as CanvasNode[]
    const rendered = render(<MultiNodeActionToolbar nodes={nodes} />)

    expect(rendered.getByText('下载 2 项')).toBeTruthy()
    expect(rendered.container.querySelector('[data-toolbar-node-ids]')?.getAttribute('data-toolbar-node-ids'))
      .toBe('node-1,node-2,node-3')
  })
})
