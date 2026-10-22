import { beforeEach, expect, it, vi } from 'vitest'
import { readCodeMetadataCache, writeCodeMetadataCache } from './videoEditCodeMetadataCache'
import { testAuthorBundle, testAuthorProgram } from '../engine/videoEditAuthorTestFixtures'
import { codeMaterialFilesKey } from '@/core/videoEdit/codeMaterial/sources'

const storage = vi.hoisted(() => new Map<string, string>())
vi.mock('@/platform/runtime', () => ({ getPlatform: () => ({ settings: {
  get: async (key: string) => storage.has(key) ? { value: storage.get(key) } : null,
  set: async (key: string, value: string) => { storage.set(key, value) },
} }) }))
beforeEach(() => storage.clear())

it('持久缓存按实际源码、组件导入映射与接口版本隔离，只保存元数据', async () => {
  const files = { entry: 'main.js', files: { 'main.js': 'export default {name:"缓存",params:[],draw(){}}' } }
  const key = codeMaterialFilesKey(files)
  const program = testAuthorProgram(testAuthorBundle(files))
  await writeCodeMetadataCache(key, program)
  expect(await readCodeMetadataCache(key)).toMatchObject({ name: '缓存', apiVersion: 4 })
  expect(await readCodeMetadataCache(key)).not.toHaveProperty('bundle')
  expect(await readCodeMetadataCache(key, 5, 4)).toBeUndefined()
  expect(await readCodeMetadataCache(key, 4, 5)).toBeUndefined()
  expect(await readCodeMetadataCache(codeMaterialFilesKey({ ...files, resolvedImports: { 'main.js': { lib: 'other.js' } } }))).toBeUndefined()
  expect(await readCodeMetadataCache(codeMaterialFilesKey({ ...files, files: { 'main.js': files.files['main.js'] + '\n' } }))).toBeUndefined()
})

it('缓存损坏只是未命中，不阻止从源码恢复', async () => {
  await writeCodeMetadataCache('source', testAuthorProgram(testAuthorBundle('export default {name:"缓存",params:[],draw(){}}')))
  const key = [...storage.keys()][0]
  storage.set(key, '{truncated')
  expect(await readCodeMetadataCache('source')).toBeUndefined()
  storage.set(key, JSON.stringify({ json: '{}', hash: 'wrong' }))
  expect(await readCodeMetadataCache('source')).toBeUndefined()
})
