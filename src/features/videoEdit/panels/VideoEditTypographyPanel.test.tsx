// @vitest-environment jsdom
import { useState } from 'react'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { defaultVideoEditTextStyle } from '@/core/videoEdit/text'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { videoEditTextPresetLibrary, VideoEditTextPresetLibrary } from '../application/videoEditTextPresets'
import { VideoEditTypographyPanel } from './VideoEditTypographyPanel'
beforeEach(() => { installHarnessNativeStorage(); videoEditTextPresetLibrary.replace([]) })
afterEach(() => { cleanup(); vi.unstubAllGlobals(); uninstallHarnessNativeStorage() })
it('共享样式操作互斥上下标，追加/删除多层外观，取消吸管不会改样式', async () => {
  const error = vi.fn(); const changed = vi.fn()
  function View() { const [style, setStyle] = useState(defaultVideoEditTextStyle(1080)); return <VideoEditTypographyPanel style={style} onError={error} onChange={next => { setStyle(next); changed(next) }} /> }
  const view = render(<View />)
  fireEvent.click(view.getByLabelText('上标')); fireEvent.click(view.getByLabelText('下标'))
  expect(changed.mock.lastCall![0]).toMatchObject({ superscript: false, subscript: true })
  fireEvent.click(view.getByLabelText('添加描边')); fireEvent.click(view.getByLabelText('添加描边')); fireEvent.click(view.getByLabelText('添加阴影'))
  expect(changed.mock.lastCall![0].strokes).toHaveLength(2); expect(changed.mock.lastCall![0].shadows).toHaveLength(1)
  fireEvent.click(view.getByLabelText('删除描边1')); expect(changed.mock.lastCall![0].strokes).toHaveLength(1)
  vi.stubGlobal('EyeDropper', class { open() { return Promise.reject(new DOMException('取消', 'AbortError')) } })
  const count = changed.mock.calls.length; fireEvent.click(view.getByLabelText('吸取文字填充颜色')); await Promise.resolve(); await Promise.resolve()
  expect(changed).toHaveBeenCalledTimes(count); expect(error).not.toHaveBeenCalled()
})
it('面板保存、应用、重命名、删除由同一本机库持久化，模板为值拷贝', () => {
  function View() { const [style, setStyle] = useState(defaultVideoEditTextStyle(1080)); return <VideoEditTypographyPanel style={style} onError={error => { throw error }} onChange={setStyle} /> }
  const view = render(<View />)
  fireEvent.click(view.getByLabelText('全部大写')); fireEvent.change(view.getByLabelText('文字样式预设名称'), { target: { value: '电影标题' } }); fireEvent.click(view.getByText('保存当前样式'))
  expect(new VideoEditTextPresetLibrary().list()[0]).toMatchObject({ name: '电影标题', style: { allCaps: true } })
  fireEvent.click(view.getByLabelText('全部大写'))
  fireEvent.click(view.getByLabelText('文字样式预设')); fireEvent.click(view.getByRole('option', { name: '电影标题' }))
  expect(view.getByLabelText('全部大写').getAttribute('aria-pressed')).toBe('true')
  fireEvent.change(view.getByLabelText('文字样式预设名称'), { target: { value: '片尾标题' } }); fireEvent.click(view.getByText('重命名'))
  expect(new VideoEditTextPresetLibrary().list()[0].name).toBe('片尾标题')
  fireEvent.click(view.getByText('删除预设')); expect(new VideoEditTextPresetLibrary().list()).toEqual([])
})
