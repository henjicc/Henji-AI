import { CODE_AUTHOR_ADJUSTMENT_MIN_API_VERSION } from '@/core/videoEdit/codeAuthorVersions'
import { afterEach, expect, it } from 'vitest'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { createRequire } from 'node:module'
import { buildSync } from 'esbuild'
import { createContentTrustTestSession } from '../../../../electron/main/services/content-trust/test-support'

afterEach(() => { Reflect.deleteProperty(globalThis, '__contentTrustExecutions') })
it('原生作者 import 在顶层求值前检查选择，声明读取也不能提前执行；信任后才执行一次', async () => {
  const fixture = createContentTrustTestSession()
  // Vite 的测试 VM 没有原生 import 回调；在普通 Node 模块里检验同一作者加载器的真实求值顺序。
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'henji-author-trust-'))
  const modulePath = path.join(directory, 'author.cjs')
  buildSync({ stdin: { contents: "export {loadAuthorModule} from './src/features/videoEdit/engine/videoEditAuthorModule';export {installAuthorTrustGate} from './src/features/videoEdit/engine/videoEditAuthorTrust'", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', outfile: modulePath, alias: { '@': path.resolve('src') }, define: { 'import.meta.env': '{}' }, logLevel: 'silent' })
  const { loadAuthorModule, installAuthorTrustGate } = createRequire(path.resolve('package.json'))(modulePath) as Pick<typeof import('./videoEditAuthorModule'), 'loadAuthorModule'> & Pick<typeof import('./videoEditAuthorTrust'), 'installAuthorTrustGate'>
  const record = { id: 'external', sourceType: 'code_asset' as const, sourceName: '作者代码' }
  const query = { contents: [record] }
  installAuthorTrustGate(request => { fixture.session.assert({ contents: request.context ?? [] }); return Promise.resolve() })
  const url = 'data:text/javascript,' + encodeURIComponent('globalThis.__contentTrustExecutions=(globalThis.__contentTrustExecutions||0)+1;export default {name:"外来代码",draw(){}}')
  try {
    await expect(loadAuthorModule(url, [record])).rejects.toThrow('等待用户确认')
    expect(Reflect.get(globalThis, '__contentTrustExecutions')).toBeUndefined()
    const first = fixture.session.check(query)
    fixture.session.decide(first.challenge!, 'deny')
    await expect(loadAuthorModule(url, [record])).rejects.toThrow('尚未运行')
    expect(Reflect.get(globalThis, '__contentTrustExecutions')).toBeUndefined()
    fixture.session.retry([record])
    fixture.session.decide(fixture.session.check(query).challenge!, 'once')
    expect((await loadAuthorModule(url, [record])).name).toBe('外来代码')
    expect(Reflect.get(globalThis, '__contentTrustExecutions')).toBe(1)
    const compatible = 'data:text/javascript,' + encodeURIComponent('class Layer { get adjust(){ throw new Error("custom getter"); } draw(){} } export default {name:"旧接口",layers:()=>[new Layer()] }')
    const info = { time: 0, frameDuration: 1 / 30, clip: { time: 0, duration: 1 } }
    for (const apiVersion of [4, 7, 8]) {
      const author = await loadAuthorModule(compatible, undefined, apiVersion)
      expect(author.layers!({}, 1, 1, {}, info)[0].draw).toBeTypeOf('function')
    }
    const adjustment = 'data:text/javascript,' + encodeURIComponent('export default {name:"调整层",layers:()=>[{id:"grade",adjust:()=>[{id:"vignette",params:{amount:Math.random()}}]}] }')
    const current = await loadAuthorModule(adjustment, undefined, CODE_AUTHOR_ADJUSTMENT_MIN_API_VERSION)
    const layer = current.layers!({}, 1, 1, {}, info)[0]
    expect(layer.adjust!(1)).toEqual(layer.adjust!(1))

  } finally { fixture.dispose(); fs.rmSync(directory, { recursive: true, force: true }) }
})
