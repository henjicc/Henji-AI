// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@/i18n/config'
import PanelTrigger from '@/components/ui/PanelTrigger'
import { UiFieldLayoutContext, useUiFieldLayout } from '@/components/ui'
import type { DropdownParamDef, SwitchParamDef, TextParamDef } from '@/core/types'
import { DropdownInput } from './base/DropdownInput'
import { SwitchInput } from './base/SwitchInput'
import { TextInput } from './base/TextInput'
import { FileUpload } from './upload/FileUpload'
import { UI_FIELD_INLINE_ROW_CLASS } from '@/components/ui'
import type { FileUploadParamDef } from '@/core/types'

vi.mock('@/contexts/NotificationContext', () => ({ useNotification: () => ({ showNotification: vi.fn() }) }))

beforeEach(async () => {
  await i18n.changeLanguage('zh-CN')
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const durationParam: DropdownParamDef = {
  id: 'duration',
  type: 'dropdown',
  order: 1,
  name: { zh: '时长', en: 'Duration' },
  default: '6',
  options: [
    { value: '6', label: { zh: '6 秒', en: '6s' } },
    { value: '10', label: { zh: '10 秒', en: '10s' } },
  ],
}

const extendParam: SwitchParamDef = {
  id: 'prompt_extend',
  type: 'switch',
  order: 2,
  name: { zh: '提示词扩展', en: 'Prompt extend' },
  default: true,
}

function inToolbar(node: JSX.Element): JSX.Element {
  return <UiFieldLayoutContext.Provider value="toolbar">{node}</UiFieldLayoutContext.Provider>
}

describe('参数控件的工具条排布（生成输入区底栏）', () => {
  it('表单排布保持标签在上与字段表面，工具条排布改为标签在左、静默触发器', () => {
    const form = render(<DropdownInput param={durationParam} value="6" onChange={() => undefined} />)
    expect(form.container.querySelector('[data-dropdown-button]')?.getAttribute('data-appearance')).toBe('field')
    expect(form.getByText('时长').closest('div')?.className).toContain('block')
    form.unmount()

    const toolbar = render(inToolbar(<DropdownInput param={durationParam} value="6" onChange={() => undefined} />))
    const trigger = toolbar.container.querySelector('[data-dropdown-button]')
    expect(trigger?.getAttribute('data-appearance')).toBe('quiet')
    const label = toolbar.getByText('时长').closest('div')
    expect(label?.className).toContain('whitespace-nowrap')
    expect(label?.className).not.toContain('block')
    // 标签与触发器在同一行容器里（按名称定位参数的巡检脚本依赖这一点）
    expect(label?.parentElement?.contains(trigger ?? null)).toBe(true)
  })

  it('工具条里的开关用胶囊，表单里保留显式“关/开”双段，读屏名称都来自参数名', () => {
    const toolbar = render(inToolbar(<SwitchInput param={extendParam} value onChange={() => undefined} />))
    const pill = toolbar.getByRole('switch', { name: '提示词扩展' })
    expect(pill.textContent).toBe('')
    toolbar.unmount()

    render(<SwitchInput param={extendParam} value onChange={() => undefined} />)
    const segmented = screen.getByRole('switch', { name: '提示词扩展' })
    expect(segmented.textContent).toContain('开')
  })

  it('大块控件在工具条里仍按表单排布，内部字段不继承工具条外观', () => {
    const textareaParam: TextParamDef = {
      id: 'negative_prompt',
      type: 'textarea',
      order: 3,
      name: { zh: '反向提示词', en: 'Negative prompt' },
      default: '',
    }
    const view = render(inToolbar(<TextInput param={textareaParam} value="" onChange={() => undefined} />))
    expect(view.getByText('反向提示词').closest('div')?.className).toContain('block')
  })

  it('PanelTrigger 打开的浮层内容重置为表单排布', () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
    let panelLayout: string | null = null
    function Probe(): JSX.Element {
      panelLayout = useUiFieldLayout()
      return <span>浮层内容</span>
    }
    const view = render(inToolbar(
      <PanelTrigger label="参数" display="768P" renderPanel={() => <Probe />} />,
    ))
    const trigger = view.container.querySelector('[data-panel-trigger-button]') as HTMLElement
    expect(trigger.getAttribute('data-appearance')).toBe('quiet')
    fireEvent.click(trigger)
    expect(screen.getByText('浮层内容')).toBeTruthy()
    expect(panelLayout).toBe('form')
  })
})

describe('文件上传在工具条排布中（3.7：声音样本）', () => {
  const sampleParam: FileUploadParamDef = {
    id: 'voice_sample',
    type: 'file-upload',
    order: 3,
    name: { zh: '声音样本', en: 'Voice sample' },
    required: true,
    default: [],
    accept: ['audio/wav'],
  }

  it('标签在左，已选文件条与上传按钮在同一行且与行同高', () => {
    const view = render(inToolbar(<FileUpload param={sampleParam} value={['data:audio/wav;base64,AAAA']} onChange={() => undefined} />))
    const root = view.container.firstElementChild as HTMLElement
    expect(root.className).toBe(UI_FIELD_INLINE_ROW_CLASS)
    expect(root.firstElementChild?.textContent).toContain('声音样本')
    const chip = view.getByText('文件 1').parentElement as HTMLElement
    expect(chip.className).toMatch(/(?:^|\s)h-8(?:\s|$)/)
  })

  it('表单排布保持标签在上', () => {
    const view = render(<FileUpload param={sampleParam} value={[]} onChange={() => undefined} />)
    expect((view.container.firstElementChild as HTMLElement).className).toContain('flex-col')
  })
})
