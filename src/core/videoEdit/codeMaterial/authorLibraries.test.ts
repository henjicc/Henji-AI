import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AUTHOR_LIBRARIES, latestAuthorLibraryVersions, authorLibraryImportTable, describeAuthorLibraries, resolveAuthorLibraryModule, type AuthorLibraryRelease } from './authorLibraries'

it('按版本表解析内置库入口，three 的多个入口共用同一版本目录', () => {
  expect(resolveAuthorLibraryModule('three')?.url).toBe('henji-media://author-lib/three/0.186.1/build/three.module.js')
  expect(resolveAuthorLibraryModule('three/webgpu')?.path).toBe('build/three.webgpu.js')
  expect(resolveAuthorLibraryModule('three/tsl')?.path).toBe('build/three.tsl.js')
  expect(resolveAuthorLibraryModule('three/addons/loaders/GLTFLoader.js')?.path).toBe('examples/jsm/loaders/GLTFLoader.js')
  expect(resolveAuthorLibraryModule('three/examples/jsm/math/SimplexNoise.js')?.path).toBe('examples/jsm/math/SimplexNoise.js')
  expect(resolveAuthorLibraryModule('opentype.js')).toMatchObject({ library: 'opentype.js', version: '2.0.0', url: 'henji-media://author-lib/opentype.js/2.0.0/opentype.mjs' })
  // 工程记录的版本优先；记录了未随包的版本时不悄悄换成别的版本。
  expect(resolveAuthorLibraryModule('three', { three: '0.186.1' })?.version).toBe('0.186.1')
  expect(resolveAuthorLibraryModule('three', { three: '0.999.0' })).toBeUndefined()
  expect(resolveAuthorLibraryModule('opentype.js', { three: '0.999.0' })?.version).toBe('2.0.0')
})

it('未登记的库、子路径与越出登记目录的路径都不解析', () => {
  for (const specifier of ['lodash', 'three/src/Three.js', 'three/addons', 'three/addons/', 'three/addons/../../build/three.cjs', 'three/addons/./x.js', 'three/addons//x.js', 'opentype.js/dist/opentype.js']) {
    expect(resolveAuthorLibraryModule(specifier), specifier).toBeUndefined()
  }
  expect(describeAuthorLibraries()).toContain('three@0.186.1（three、three/webgpu、three/tsl、three/addons/*、three/examples/jsm/*）')
  expect(authorLibraryImportTable().modules).toEqual({})
  expect(authorLibraryImportTable().directories).toEqual([])
  expect(authorLibraryImportTable(undefined, 5).directories).toContainEqual(['three/addons/', 'henji-media://author-lib/three/0.186.1/examples/jsm/'])
})

it('新代码选择兼容最新版，历史默认与显式冻结版本保持独立', () => {
  expect(latestAuthorLibraryVersions(6)['henji-layout']).toBe('1.2.0')
  expect(latestAuthorLibraryVersions(5)['henji-layout']).toBeUndefined()
  expect(resolveAuthorLibraryModule('henji-layout/text')?.version).toBe('1.0.0')
  expect(resolveAuthorLibraryModule('henji-layout/text', { 'henji-layout': '1.1.0' })?.version).toBe('1.1.0')
})

describe('追加新版本与改默认版本', () => {
  // 模拟以后随包加入 three 新版本并把新代码的默认版本改过去。
  const three = AUTHOR_LIBRARIES.three as Record<string, AuthorLibraryRelease>
  beforeEach(() => { three['0.200.0'] = three['0.186.1'] })
  afterEach(() => { delete three['0.200.0'] })

  it('记录了版本的按记录解析；没有记录的旧版本一直按第一套，默认版本变化不影响它们', () => {
    expect(latestAuthorLibraryVersions(5).three).toBe('0.200.0')
    expect(latestAuthorLibraryVersions(4)).toEqual({})
    expect(resolveAuthorLibraryModule('three', { three: '0.200.0' })?.url).toBe('henji-media://author-lib/three/0.200.0/build/three.module.js')
    expect(resolveAuthorLibraryModule('three', { three: '0.186.1' })?.version).toBe('0.186.1')
    expect(resolveAuthorLibraryModule('three')?.version).toBe('0.186.1')
    expect(resolveAuthorLibraryModule('three/addons/math/SimplexNoise.js', {})?.version).toBe('0.186.1')
    expect(authorLibraryImportTable({ three: '0.200.0' }, 5).modules.three).toBe('henji-media://author-lib/three/0.200.0/build/three.module.js')
  })
})

it('效果库只在兼容接口自动锁定，显式不存在的发行不换版本', () => {
  expect(resolveAuthorLibraryModule('henji-effects', latestAuthorLibraryVersions(7))).toBeDefined()
  expect(resolveAuthorLibraryModule('henji-effects')?.version).toBe('1.0.0')
  expect(latestAuthorLibraryVersions(6)['henji-effects']).toBeUndefined()
  expect(resolveAuthorLibraryModule('henji-effects', { 'henji-effects': '9.0.0' })).toBeUndefined()
  expect(authorLibraryImportTable({ 'henji-effects': '1.0.0' }, 7).modules['henji-effects']).toContain('/henji-effects/1.0.0/index.mjs')
})

it('带库依赖的库只在依赖版本一致时提供，记录了别的依赖版本时给出原因', async () => {
  const { authorLibraryDependencyError } = await import('./authorLibraries')
  expect(latestAuthorLibraryVersions(15)['three-gpu-pathtracer']).toBeDefined()
  expect(latestAuthorLibraryVersions(14)['three-gpu-pathtracer']).toBeUndefined()
  expect(authorLibraryDependencyError('three-gpu-pathtracer', '0.0.27', { three: '0.186.1', 'three-mesh-bvh': '0.9.17' })).toBeUndefined()
  const three = AUTHOR_LIBRARIES.three as Record<string, AuthorLibraryRelease>
  three['0.200.0'] = three['0.186.1']
  try {
    // three 出了新版而路径追踪器还钉在旧版：新代码选 three 新版时不提供它，避免两份 three。
    expect(latestAuthorLibraryVersions(15).three).toBe('0.200.0')
    expect(latestAuthorLibraryVersions(15)['three-gpu-pathtracer']).toBeUndefined()
    expect(authorLibraryDependencyError('three-gpu-pathtracer', '0.0.27', { three: '0.200.0' })).toContain('three@0.186.1')
  } finally { delete three['0.200.0'] }
})
