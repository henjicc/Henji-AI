import { expect, it } from 'vitest'
import { userErrorText } from './userErrorText'

it('界面失败原因：去掉错误码前缀与拼接的英文原始输出，纯英文换成兜底说法', () => {
  expect(userErrorText(new Error('NOT_FOUND：口播不存在或文件已被移走。'), '兜底')).toBe('口播不存在或文件已被移走。')
  expect(userErrorText(new Error('屏幕采集未能启动（-5）：DXGI_ERROR_ACCESS_LOST at capture.rs:120'), '兜底')).toBe('屏幕采集未能启动（-5）。')
  expect(userErrorText(new Error("Failed to execute 'importExternalTexture' on 'GPUDevice'"), '兜底')).toBe('兜底')
  expect(userErrorText('Error: 录制服务没有启动，请重启软件。', '兜底')).toBe('录制服务没有启动，请重启软件。')
  expect(userErrorText(new Error('请先选择窗口：可以在左侧列表里选。'), '兜底')).toBe('请先选择窗口：可以在左侧列表里选。')
  expect(userErrorText(new Error('CONFLICT:口播正在连续变化，请稍后重试。'), '兜底')).toBe('口播正在连续变化，请稍后重试。')
  expect(userErrorText(undefined, '兜底')).toBe('兜底')
})

it('路径或引号里的中文不算用户语言；名称与缩写前缀照留', () => {
  expect(userErrorText(new Error(String.raw`ENOENT: no such file or directory, open 'E:\文档\HenjiAI\a.wav'`), '兜底')).toBe('找不到需要的文件，它可能已被移动或删除。')
  expect(userErrorText(new Error(String.raw`spawn failed for "E:\文档\录制\capture.exe"`), '兜底')).toBe('兜底')
  expect(userErrorText(new Error('找不到素材：intro.mp4'), '兜底')).toBe('找不到素材：intro.mp4')
  expect(userErrorText(new Error('找不到字体：Source Han Sans SC'), '兜底')).toBe('找不到字体：Source Han Sans SC')
  expect(userErrorText(new Error('GPU：显存不足，已降低预览分辨率。'), '兜底')).toBe('GPU：显存不足，已降低预览分辨率。')
})
