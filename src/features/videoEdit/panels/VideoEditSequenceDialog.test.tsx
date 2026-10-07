// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { VideoEditSequenceDialog } from './VideoEditSequenceDialog'
import { useSettingsStore } from '@/stores/settingsStore'
import { VIDEO_EDIT_SEQUENCE_DEFAULTS } from '@/core/videoEdit/sequenceDefaults'
import type { VideoEditSequenceSettings } from '../application/videoEditProjectItems'
beforeEach(() => useSettingsStore.getState().setVideoEditSequenceDefaults(structuredClone(VIDEO_EDIT_SEQUENCE_DEFAULTS)))
afterEach(() => { cleanup(); useSettingsStore.getState().setVideoEditSequenceDefaults(structuredClone(VIDEO_EDIT_SEQUENCE_DEFAULTS)) })
function dialog(initial: VideoEditSequenceSettings = {}, requireFrameRate = false) {
  const submit = vi.fn(); const close = vi.fn()
  const view = render(<VideoEditSequenceDialog title="新建序列" initial={initial} bins={[]} requireFrameRate={requireFrameRate} onClose={close} onSubmit={submit} />)
  return { ...view, submit, close }
}
it('比例与档位组合输出8K竖屏、高帧率；根素材箱一直可选择', async () => {
  const view = dialog()
  expect(view.getByLabelText('序列素材箱')).toBeTruthy()
  fireEvent.click(view.getByRole('button', { name: '9:16' }))
  fireEvent.click(view.getByRole('button', { name: '8K' }))
  fireEvent.click(view.getByRole('button', { name: '120 帧' }))
  await act(async () => fireEvent.click(view.getByRole('button', { name: '新建' })))
  expect(view.submit).toHaveBeenCalledWith(expect.objectContaining({ width: 4320, height: 7680, frameRate: { numerator: 120, denominator: 1 }, binId: null }))
})
it('超宽8K禁用；切换超宽比例从不合法8K退到4K', async () => {
  const view = dialog({ width: 7680, height: 4320 })
  fireEvent.click(view.getByRole('button', { name: '21:9' }))
  expect(view.getByRole('button', { name: '8K' })).toHaveProperty('disabled', true)
  await act(async () => fireEvent.click(view.getByRole('button', { name: '新建' })))
  expect(view.submit).toHaveBeenCalledWith(expect.objectContaining({ width: 5120, height: 2160 }))
})
it('打开时反推常见超宽比例和档位，非预设尺寸落到自定义且保留值', () => {
  const view = dialog({ width: 3440, height: 1440 })
  expect(view.getByRole('button', { name: '21:9' }).getAttribute('aria-pressed')).toBe('true')
  expect(view.getByRole('button', { name: '2K' }).getAttribute('aria-pressed')).toBe('true')
  cleanup()
  const custom = dialog({ width: 2048, height: 1080 })
  expect(custom.getByLabelText('宽度')).toHaveProperty('value', '2048')
  expect(custom.queryByRole('group', { name: '分辨率档位' })).toBeNull()
})
it('自定义宽高允许非档位尺寸；总像素超限不提交或保存默认', async () => {
  const view = dialog()
  fireEvent.click(view.getByRole('button', { name: '自定义' }))
  fireEvent.change(view.getByLabelText('宽度'), { target: { value: '6000' } })
  fireEvent.change(view.getByLabelText('高度'), { target: { value: '6000' } })
  await act(async () => fireEvent.click(view.getByRole('button', { name: '新建' })))
  expect(view.submit).not.toHaveBeenCalled()
  fireEvent.click(view.getByRole('button', { name: '保存为默认值' }))
  expect(useSettingsStore.getState().videoEditSequenceDefaults).toEqual(VIDEO_EDIT_SEQUENCE_DEFAULTS)
  fireEvent.change(view.getByLabelText('高度'), { target: { value: '4000' } })
  await act(async () => fireEvent.click(view.getByRole('button', { name: '新建' })))
  expect(view.submit).toHaveBeenCalledWith(expect.objectContaining({ width: 6000, height: 4000 }))
})
it('默认值保存包括更多设置；修改任何字段后可重新保存', () => {
  const view = dialog()
  expect(view.queryByLabelText('像素长宽比')).toBeNull()
  fireEvent.click(view.getByRole('button', { name: '更多设置' }))
  fireEvent.change(view.getByLabelText('像素长宽比'), { target: { value: '4/3' } })
  fireEvent.change(view.getByLabelText('音频采样率'), { target: { value: '44100' } })
  fireEvent.change(view.getByLabelText('声道'), { target: { value: '1' } })
  fireEvent.click(view.getByRole('button', { name: '100 帧' }))
  fireEvent.click(view.getByRole('button', { name: '保存为默认值' }))
  expect(useSettingsStore.getState().videoEditSequenceDefaults).toMatchObject({ frameRate: { numerator: 100, denominator: 1 }, pixelAspectRatio: { numerator: 4, denominator: 3 }, sampleRate: 44100, channels: 1 })
  expect(view.getByRole('button', { name: '已保存为默认值' })).toBeTruthy()
  fireEvent.click(view.getByRole('button', { name: '100 帧' }))
  expect(view.getByRole('button', { name: '已保存为默认值' })).toBeTruthy()
  fireEvent.change(view.getByLabelText('序列名称'), { target: { value: '新名称' } })
  expect(view.getByRole('button', { name: '保存为默认值' })).toBeTruthy()
})
it('不可靠素材必须主动确认预选60帧，保存默认值也不绕过确认', async () => {
  const view = dialog({ frameRate: { numerator: 24, denominator: 1 } }, true)
  fireEvent.click(view.getByRole('button', { name: '保存为默认值' }))
  expect(view.queryByRole('button', { name: '已保存为默认值' })).toBeNull()
  await act(async () => fireEvent.click(view.getByRole('button', { name: '新建' })))
  expect(view.submit).not.toHaveBeenCalled()
  fireEvent.click(view.getByRole('button', { name: '60 帧' }))
  await act(async () => fireEvent.click(view.getByRole('button', { name: '新建' })))
  expect(view.submit).toHaveBeenCalledWith(expect.objectContaining({ frameRate: { numerator: 60, denominator: 1 } }))
})
