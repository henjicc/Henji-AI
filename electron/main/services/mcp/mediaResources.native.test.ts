import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { randomUUID } from 'node:crypto'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

if (!process.versions.electron) throw new Error('本测试必须由正式 Electron SQLite 原生运行器执行，不能跳过原生边界。')
const fixture = vi.hoisted(() => ({ root: '', db: undefined as Database.Database | undefined }))
vi.mock('electron', () => ({ app: { getPath: (name: string) => path.join(fixture.root, name), isPackaged: false }, protocol: {} }))
vi.mock('../db', async (importOriginal) => ({ ...await importOriginal<typeof import('../db')>(), getDb: () => {
  if (!fixture.db) throw new Error('原生夹具连接尚未初始化')
  return fixture.db
} }))
vi.mock('../logging', () => ({ createMainLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }))
import { initializeSchema } from '../db'
import { upsertStoryboardProject } from '../storyboard-projects'
import { isPathWithinAllowedMediaRoots } from '../../protocol'
import { readMcpMediaResource } from './mediaResources'
import { McpConnections } from './connections'
import { ApplicationHostBridge } from './applicationHostBridge'
import { LocalMcpServer } from './server'

let parent: string
let file: string
const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4])
beforeAll(async () => {
  parent = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-mcp-native-media-'))
  fixture.root = path.join(parent, 'profile')
  await fs.mkdir(path.join(fixture.root, 'downloads'), { recursive: true })
  vi.stubEnv('LOCALAPPDATA', path.join(fixture.root, 'local'))
  fixture.db = new Database(path.join(parent, 'media.sqlite'))
  initializeSchema(fixture.db)
  file = path.join(fixture.root, 'downloads', 'result.png')
  await fs.writeFile(file, bytes)
  fixture.db.prepare('INSERT INTO history (id,provider_id,model_id,type,params,file_path,status) VALUES (?,?,?,?,?,?,?)').run('generation-result', 'fixture', 'fixture', 'image', '{}', file, 'success')
  fixture.db.prepare('INSERT INTO assets (id,media_type,display_name,file_path,source,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run('asset-result', 'image', '实际媒体', file, 'imported', 1, 1)
  upsertStoryboardProject({ id: 'media-project', name: '媒体项目', createdAt: 1, updatedAt: 1, nodeCount: 1,
    nodesJson: JSON.stringify([{ id: 'media-node', type: 'image', position: { x: 0, y: 0 }, data: { imageUrl: '__img_ref__:0' } }]),
    edgesJson: '[]', viewportJson: '{"x":0,"y":0,"zoom":1}', historyJson: JSON.stringify({ past: [], future: [], imagePool: [file] }) })
  fixture.db.close()
  fixture.db = new Database(path.join(parent, 'media.sqlite'))
})
afterAll(async () => {
  fixture.db?.close(); fixture.db = undefined
  vi.unstubAllEnvs()
  // 本测试创建的独立临时目录，解析后确认边界再删除。
  if (parent && path.dirname(path.resolve(parent)) === path.resolve(os.tmpdir()) && path.basename(parent).startsWith('henji-mcp-native-media-')) await fs.rm(parent, { recursive: true, force: true })
})

it.each([
  { kind: 'generation.result', id: 'generation-result' },
  { kind: 'asset', id: 'asset-result' },
  { kind: 'canvas.node', id: 'media-project:media-node' },
])('物理SQLite重新打开后，$kind 正式解析返回真实媒体分块', async (ref) => {
  expect(isPathWithinAllowedMediaRoots(file)).toBe(true)
  const result = await readMcpMediaResource({ ref, offset: 4, length: 5 })
  expect(result).toEqual({ mimeType: 'image/png', base64: bytes.subarray(4, 9).toString('base64'), offset: 4, byteLength: 5, totalBytes: bytes.length, eof: false })
  expect(await readMcpMediaResource({ ref, offset: bytes.length })).toMatchObject({ base64: '', byteLength: 0, eof: true })
})

it('正式记录未保存和真实媒体根外路径拒绝；读取不自行扩大授权', async () => {
  await expect(readMcpMediaResource({ ref: { kind: 'generation.result', id: 'not-saved' } })).rejects.toMatchObject({ code: 'MEDIA_NOT_PERSISTED' })
  const outside = path.join(parent, 'outside.png'); await fs.writeFile(outside, bytes)
  fixture.db!.prepare('INSERT INTO assets (id,media_type,display_name,file_path,source,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run('outside', 'image', '未授权', outside, 'external', 1, 1)
  expect(isPathWithinAllowedMediaRoots(outside)).toBe(false)
  await expect(readMcpMediaResource({ ref: { kind: 'asset', id: 'outside' } })).rejects.toMatchObject({ code: 'MEDIA_ACCESS_DENIED' })
  expect(isPathWithinAllowedMediaRoots(outside)).toBe(false)
})

it('真实SDK客户端读取媒体，缺少凭据和撤销连接后均不能读取', async () => {
  const connections = new McpConnections({ read: () => null, write: () => {} })
  const connection = connections.create('媒体客户端')
  const bridge = new ApplicationHostBridge((id) => connections.assertActive(id))
  bridge.register({ sessionId: randomUUID(), generation: 1, ready: true, tools: [] }, { send: () => { throw new Error('媒体不得转发渲染执行') } })
  const server = new LocalMcpServer(connections, bridge)
  const client = new Client({ name: 'native-media', version: '1' })
  try {
    await server.start(0)
    const url = new URL(`http://127.0.0.1:${server.listeningPort}/mcp`)
    expect((await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status).toBe(401)
    await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers: { Authorization: `Bearer ${connections.token(connection.id)}` } } }))
    const result = await client.callTool({ name: 'read_application_media', arguments: { ref: { kind: 'asset', id: 'asset-result' }, length: 5 } })
    expect(result.isError).not.toBe(true)
    expect(result.structuredContent).toMatchObject({ mimeType: 'image/png', byteLength: 5, totalBytes: bytes.length, base64: bytes.subarray(0, 5).toString('base64') })
    connections.revoke(connection.id)
    await expect(client.callTool({ name: 'read_application_media', arguments: { ref: { kind: 'asset', id: 'asset-result' } } })).rejects.toThrow()
  } finally { await client.close(); await server.stop() }
})
