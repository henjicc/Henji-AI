import { BrowserWindow, session, webContents } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import { WebSourcePage } from '../../electron/main/services/web-source/page'
import { WebCacheRegistrations } from '../../electron/main/services/web-source/registration'
import { webSourceSession } from '../../electron/main/services/web-source/session'
import { webSourceContentHash } from '../../electron/main/services/web-source/site'
import { ContentTrustSession } from '../../electron/main/services/content-trust/runtime'
import { createMainLogger } from '../../electron/main/services/logging/main-logger'
import type { VideoFrameTarget } from '../../electron/main/services/video-decoder/texture-bridge'
import { appendLogEvents } from '../../electron/main/services/logging/push'
import { queryLogEvents } from '../../electron/main/services/logging/query'

export async function environmentProbe(output: string): Promise<unknown> {
  const root = path.join(output, 'environment-site')
  await fs.mkdir(root, { recursive: true })
  await fs.writeFile(path.join(root, 'index.html'), '<!doctype html><body>Environment<script>window.henjiWeb={ready:Promise.resolve(),duration:1,seek:async()=>{}}</script>')
  const logger = createMainLogger('main.web_source')
  let policy = false
  const trust = new ContentTrustSession(() => policy, value => { policy = value })
  const registrations = new WebCacheRegistrations(trust, logger)
  const host = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } })
  const target: VideoFrameTarget = { id: host.webContents.id, mainFrame: host.webContents.mainFrame, isDestroyed: () => host.isDestroyed(), send: () => undefined,
    onGone: callback => { const gone = (): void => callback('closed'); host.once('closed', gone); return () => host.removeListener('closed', gone) } }
  const page = new WebSourcePage('environment', target, 'probe', { root }, { width: 257, height: 259, region: [0, 0, 257, 259], scale: 1 }, await webSourceContentHash(root), () => undefined, () => undefined)
  let environment: Awaited<ReturnType<NonNullable<ReturnType<WebCacheRegistrations['get']>>['environment']>>
  const external = [{ id: 'fixture', sourceType: 'project' as const, sourceName: '自造外来来源夹具' }]
  try {
    await registrations.register(page, external)
    if (registrations.get(page.streamId)) throw new Error('未确认来源登记成功')
    trust.decide(trust.check({ contents: external }).challenge!, 'once')
    await page.open()
    await registrations.register(page, external)
    const registration = registrations.get(page.streamId)
    if (!registration) throw new Error('已确认来源未登记')
    const started = performance.now()
    environment = await registration.environment()
    const fontSnapshotMs = performance.now() - started
    const sourceSession = webSourceSession(root)
    if (!environment || !await environment.current(true)) throw new Error(`稳定环境不能录制：${sourceSession.reason}`)
    const contents = webContents.getAllWebContents().find(contents => contents.session === session.fromPartition(sourceSession.partition))!
    const storageEvents: string[] = []
    const mutate = async (kind: string, code: string): Promise<void> => {
      const before = sourceSession.storageSignature
      await contents.executeJavaScript(code)
      const deadline = performance.now() + 3000
      while (before === sourceSession.storageSignature && performance.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10))
      if (before === sourceSession.storageSignature) throw new Error(`${kind} 未触发环境失效`)
      storageEvents.push(kind)
    }
    await mutate('localStorage', 'localStorage.setItem("fixture","one")')
    if (await environment.current()) throw new Error('存储变化后旧环境仍有效')
    await mutate('sessionStorage', 'sessionStorage.setItem("fixture","one")')
    await mutate('cookie', 'document.cookie="fixture=one; SameSite=Strict"')
    await mutate('IndexedDB', `new Promise((resolve,reject)=>{const r=indexedDB.open('fixture',1);r.onupgradeneeded=()=>r.result.createObjectStore('data');r.onsuccess=()=>{const db=r.result,t=db.transaction('data','readwrite');t.objectStore('data').put('one','key');t.oncomplete=()=>{db.close();resolve()};t.onerror=reject};r.onerror=reject})`)
    await mutate('CacheStorage', 'caches.open("fixture").then(c=>c.put("/fixture",new Response("one")))')
    await contents.executeJavaScript('window.fixtureSocket = new WebSocket("ws://127.0.0.1:1/fixture")')
    const deadline = performance.now() + 3000
    while (!sourceSession.reason && performance.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10))
    if (sourceSession.reason !== 'external-request') throw new Error(`WebSocket 未被全协议监听识别：${sourceSession.reason}`)
    host.destroy()
    if (registration.current || !registration.signal.aborted) throw new Error('宿主关闭后登记仍有效')
    await appendLogEvents([{ timestamp: new Date().toISOString(), level: 'debug', domain: 'main.web_source', event: 'web_source.probe.completed', message: '环境登记专项完成', source: 'backend' }])
    const logs = await queryLogEvents({ date: new Date().toISOString().slice(0, 10), domainPrefix: 'main.web_source' })
    const events = logs.events.map(event => event.event)
    if (logs.corruptedLines || !events.includes('web_source.registration.completed') || !events.includes('web_source.registration.removed')) throw new Error('环境登记日志未从正式查询读回')
    return { stable: true, fontSnapshotMs, signature: environment.signature, storageEvents, externalRequest: 'webSocket', closedRevoked: true, unconfirmedRejected: true,
      logs: { events, corruptedLines: logs.corruptedLines }, versions: process.versions }
  } finally { environment?.close(); registrations.dispose(); page.close(); if (!host.isDestroyed()) host.destroy() }
}
