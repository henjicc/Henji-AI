import { describe, expect, it } from 'vitest'

import { isTrustedMainRendererUrl } from './main-renderer-url'

describe('主窗口 renderer URL 策略', () => {
  it('开发环境只接受配置服务器的同源页面', () => {
    const policy = { developmentUrl: 'http://127.0.0.1:5173/' }
    expect(isTrustedMainRendererUrl('http://127.0.0.1:5173/editor#tool', policy)).toBe(true)
    expect(isTrustedMainRendererUrl('http://localhost:5173/editor', policy)).toBe(false)
    expect(isTrustedMainRendererUrl('file:///tmp/renderer.html', policy)).toBe(false)
  })

  it('生产环境只接受唯一入口文件，但允许自身的查询与 hash', () => {
    const policy = { developmentUrl: '', packagedEntryPath: '/Applications/Henji/renderer/index.html' }
    expect(isTrustedMainRendererUrl(
      'file:///Applications/Henji/renderer/index.html?view=main#editor',
      policy,
    )).toBe(true)
    expect(isTrustedMainRendererUrl('file:///tmp/attacker.html', policy)).toBe(false)
    expect(isTrustedMainRendererUrl('https://example.test/', policy)).toBe(false)
  })
})
