// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import i18n from '@/i18n/config'
import { NotificationProvider } from '@/contexts/NotificationContext'
import type { FileUploadParamDef, TextParamDef } from '@/core/types'
import { TextInput } from './base/TextInput'
import { FileUpload } from './upload/FileUpload'

beforeEach(async () => {
  await i18n.changeLanguage('zh-CN')
})

afterEach(cleanup)

describe('参数标签说明入口', () => {
  it('由可聚焦的参数名称直接触发 tooltip，不显示图标或 description', () => {
    const param: TextParamDef = {
      id: 'prompt',
      type: 'text',
      order: 1,
      name: { zh: '提示词', en: 'Prompt' },
      tooltip: { zh: '描述希望生成的画面。', en: 'Describe the image to generate.' },
      description: { zh: '供智能助手理解的参数语义', en: 'Assistant-facing semantics' },
      default: '',
    }

    render(<TextInput param={param} value="" onChange={() => undefined} />)

    expect(screen.queryByText('供智能助手理解的参数语义')).toBeNull()
    expect(screen.queryByRole('button', { name: /提示词.*说明/ })).toBeNull()
    const label = screen.getByText('提示词')
    const trigger = label.closest('[tabindex="0"]')
    const tooltip = screen.getByRole('tooltip', { hidden: true })
    expect(trigger).not.toBeNull()
    expect(trigger?.getAttribute('aria-describedby')).toBe(tooltip.id)
    expect(tooltip.getAttribute('aria-hidden')).toBe('true')

    fireEvent.focus(trigger as HTMLElement)
    expect(tooltip.getAttribute('aria-hidden')).toBe('false')
    expect(tooltip.textContent).toBe('描述希望生成的画面。')
  })

  it('文件上传参数同样不把 description 摊在控件下方', () => {
    const param: FileUploadParamDef = {
      id: 'document',
      type: 'file-upload',
      order: 2,
      name: { zh: '参考文档', en: 'Reference document' },
      description: { zh: '供智能助手理解的文件用途', en: 'Assistant-facing file semantics' },
      default: [],
      maxCount: 1,
    }

    render(
      <NotificationProvider>
        <FileUpload param={param} value={[]} onChange={() => undefined} />
      </NotificationProvider>
    )

    expect(screen.getByText('参考文档')).toBeTruthy()
    expect(screen.queryByText('供智能助手理解的文件用途')).toBeNull()
    expect(screen.getByText('参考文档').closest('[tabindex]')).toBeNull()
  })
})
