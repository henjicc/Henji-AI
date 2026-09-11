import type { IpcMainInvokeEvent } from 'electron'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { assertTrustedMainRenderer } from './main-renderer'

const fixture = vi.hoisted(() => ({ main: { isDestroyed: () => false }, owner: null as object | null }))
vi.mock('electron', () => ({ BrowserWindow: { fromWebContents: () => fixture.owner } }))
vi.mock('../window', () => ({ getMainWindow: () => fixture.main }))

describe('重建宿主任务归属的正式窗口边界', () => {
  afterEach(() => { vi.unstubAllEnvs() })
  const event = (url: string, topLevel = true) => {
    const mainFrame = { url }
    return { sender: { mainFrame }, senderFrame: topLevel ? mainFrame : { url } } as unknown as IpcMainInvokeEvent
  }
  it('只有正式主窗口顶层的可信来源能重新关联已保存任务', () => {
    vi.stubEnv('ELECTRON_RENDERER_URL', 'http://localhost:5173')
    fixture.owner = fixture.main
    expect(() => assertTrustedMainRenderer(event('http://localhost:5173/?view=canvas'))).not.toThrow()
    expect(() => assertTrustedMainRenderer(event('http://localhost:5173', false))).toThrow('sender')
    expect(() => assertTrustedMainRenderer(event('https://untrusted.invalid'))).toThrow('origin')
    fixture.owner = { isDestroyed: () => false }
    expect(() => assertTrustedMainRenderer(event('http://localhost:5173'))).toThrow('sender')
  })
})
