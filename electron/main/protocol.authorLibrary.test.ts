import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { protocol } from 'electron'

const roots = vi.hoisted(() => ({ app: '' }))
vi.mock('electron', () => ({ app: { isPackaged: false, getAppPath: () => roots.app, getPath: () => roots.app }, protocol: { registerSchemesAsPrivileged: vi.fn(), handle: vi.fn() } }))
vi.mock('./services/appPaths', () => ({ CONTENT_ADDRESSED_FOLDER_NAMES: new Set(), getAppBaseDir: () => path.join(roots.app, 'user'), getUserRootDir: () => path.join(roots.app, 'user') }))
vi.mock('./services/image-editor-v3/resource-media-url', () => ({ IMAGE_EDITOR_V3_MEDIA_HOST: 'image-editor-v3', resolveImageEditorV3ResourceMediaUrl: vi.fn() }))

let handler: (request: Request) => Promise<Response>
beforeAll(async () => {
  roots.app = await mkdtemp(path.join(os.tmpdir(), 'henji-author-lib-'))
  const library = path.join(roots.app, 'resources', 'author-libs', 'three', '0.186.1')
  await mkdir(path.join(library, 'build'), { recursive: true })
  await writeFile(path.join(library, 'build', 'three.core.js'), 'export const REVISION = "186";')
  await writeFile(path.join(roots.app, 'resources', 'secret.js'), 'export const leaked = true;')
  await mkdir(path.join(roots.app, 'outside'), { recursive: true })
  await writeFile(path.join(roots.app, 'outside', 'linked.js'), 'export const leaked = true;')
  await symlink(path.join(roots.app, 'outside'), path.join(library, 'linked'), 'junction')
  const { registerMediaProtocolHandler } = await import('./protocol')
  registerMediaProtocolHandler()
  handler = vi.mocked(protocol.handle).mock.calls.at(-1)![1] as typeof handler
})
afterAll(async () => { await rm(roots.app, { recursive: true, force: true }) })

it('内置作者库按版本目录提供，可跨协议加载并长期缓存', async () => {
  const response = await handler(new Request('henji-media://author-lib/three/0.186.1/build/three.core.js'))
  expect(response.status).toBe(200)
  expect(response.headers.get('Content-Type')).toBe('text/javascript')
  expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
  expect(response.headers.get('Cache-Control')).toContain('immutable')
  expect(await response.text()).toBe('export const REVISION = "186";')
})

it('只读：写方法被拒绝', async () => {
  const response = await handler(new Request('henji-media://author-lib/three/0.186.1/build/three.core.js', { method: 'PUT', body: 'x' }))
  expect(response.status).toBe(405)
})

it('命名空间保持相对定位语义，目录链接照常读取', async () => {
  const absolute = encodeURIComponent(path.join(roots.app, 'resources', 'secret.js'))
  for (const url of [
    'henji-media://author-lib/three/0.186.1/%2e%2e/%2e%2e/%2e%2e/secret.js',
    'henji-media://author-lib/three%2F..%2F..%2Fsecret.js',
    'henji-media://author-lib/..%5C..%5Csecret.js',
    `henji-media://author-lib/${absolute}`,
  ]) {
    const response = await handler(new Request(url))
    expect(response.status, url).not.toBe(200)
  }
  const linked = await handler(new Request('henji-media://author-lib/three/0.186.1/linked/linked.js'))
  expect(linked.status).toBe(200)
  expect(await linked.text()).toBe('export const leaked = true;')
  // 失败也带跨源头，Worker 才能读到真实状态而不是笼统的 CORS 拒绝。
  expect(linked.headers.get('Access-Control-Allow-Origin')).toBe('*')
  expect((await handler(new Request('henji-media://author-lib/three/0.186.1/missing.js'))).headers.get('Access-Control-Allow-Origin')).toBe('*')
})
