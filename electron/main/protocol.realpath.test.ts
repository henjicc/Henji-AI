import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { protocol } from 'electron'

const roots = vi.hoisted(() => ({ base: '', user: '' }))
vi.mock('electron', () => ({ app: { getPath: () => roots.user }, protocol: { registerSchemesAsPrivileged: vi.fn(), handle: vi.fn() } }))
vi.mock('./services/appPaths', () => ({ CONTENT_ADDRESSED_FOLDER_NAMES: new Set(), getAppBaseDir: () => roots.base, getUserRootDir: () => roots.user }))
vi.mock('./services/image-editor-v3/resource-media-url', () => ({ IMAGE_EDITOR_V3_MEDIA_HOST: 'image-editor-v3', resolveImageEditorV3ResourceMediaUrl: vi.fn() }))
vi.mock('./services/media/rootGrants', () => ({ persistMediaRootGrant: vi.fn(), restorePersistedMediaRoots: vi.fn(() => []) }))

let directory: string
beforeEach(async () => { directory = await mkdtemp(path.join(os.tmpdir(), 'henji-root-')) })
afterEach(async () => { await rm(directory, { recursive: true, force: true }) })

// 复现：从 MSIX 打包应用启动时 AppData\Local 被重定向，程序缓存的真实位置不在字面白名单里。
it('白名单目录经链接或重定向时，按真实位置比较仍判为授权范围内', async () => {
  const actual = path.join(directory, 'redirected', 'com.henji.ai')
  await mkdir(path.join(actual, 'cache'), { recursive: true })
  const file = path.join(actual, 'cache', 'audio.wav')
  await writeFile(file, 'x')
  roots.base = path.join(directory, 'com.henji.ai')
  roots.user = path.join(directory, 'user')
  await symlink(actual, roots.base, 'junction')
  const { isPathWithinAllowedMediaRoots, isRealPathWithinAllowedMediaRoots } = await import('./protocol')
  const resolved = await realpath(path.join(roots.base, 'cache', 'audio.wav'))
  expect(isPathWithinAllowedMediaRoots(resolved)).toBe(false)
  expect(await isRealPathWithinAllowedMediaRoots(resolved)).toBe(true)
  expect(await isRealPathWithinAllowedMediaRoots(path.join(directory, 'elsewhere.wav'))).toBe(false)
})

it('授权临时目录的原生 ESM 返回 JavaScript 类型与跨协议加载头', async () => {
  roots.base = directory; roots.user = directory
  const file = path.join(directory, 'module.mjs')
  await writeFile(file, 'export const value = 3;')
  const { registerMediaProtocolHandler } = await import('./protocol')
  registerMediaProtocolHandler()
  const handler = vi.mocked(protocol.handle).mock.calls.at(-1)![1]
  const response = await handler(new Request(`henji-media://local/${encodeURIComponent(file)}`))
  expect(response.headers.get('Content-Type')).toBe('text/javascript')
  expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
  expect(await response.text()).toBe('export const value = 3;')
})
