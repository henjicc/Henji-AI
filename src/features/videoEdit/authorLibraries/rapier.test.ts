import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { Worker } from 'node:worker_threads'
import { expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { AUTHOR_LIBRARIES } from '../../../core/videoEdit/codeMaterial/authorLibraries'
import { CODE_AUTHOR_SIMULATION_MIN_API_VERSION } from '../../../core/videoEdit/codeAuthorVersions'

it('冻结 Rapier 的 init 失败向所有调用方传播，下一次可重试且成功后继续去重', async () => {
  const [release] = Object.values(AUTHOR_LIBRARIES['@dimforge/rapier3d-deterministic-compat'])
  const url = pathToFileURL(path.resolve(release.frozen!, 'rapier.mjs')).href
  const worker = new Worker(`
    const { parentPort } = require('node:worker_threads');
    (async () => {
      const instantiate = WebAssembly.instantiate;
      const failure = new Error('首次 Wasm 初始化失败');
      let attempts = 0;
      // 只数 Rapier 自己的实例化：Node 内部模块也可能在同一线程调用 instantiate，且各版本、平台不同
      WebAssembly.instantiate = (...args) => !(args[1] && './rapier_wasm3d_bg.js' in args[1])
        ? Reflect.apply(instantiate, WebAssembly, args)
        : ++attempts === 1 ? Promise.reject(failure) : Reflect.apply(instantiate, WebAssembly, args);
      try {
        const module = await import(${JSON.stringify(url)});
        const first = module.init(), concurrent = module.default.init();
        const failed = await Promise.allSettled([first, concurrent]);
        const retry = module.default.init(), retryConcurrent = module.init();
        await retry;
        const world = new module.default.World({ x: 0, y: -9.81, z: 0 });
        try {
          world.step();
          parentPort.postMessage({
            sharedInit: module.init === module.default.init,
            sharedFailure: first === concurrent,
            originalErrors: failed.map(result => result.status === 'rejected' && result.reason === failure),
            newAttempt: retry !== first,
            sharedRetry: retry === retryConcurrent,
            cachedSuccess: retry === module.init(),
            attempts,
            snapshotBytes: world.takeSnapshot().byteLength,
          });
        } finally { world.free(); }
      } finally { WebAssembly.instantiate = instantiate; }
    })().catch(error => { throw error; });
  `, { eval: true })
  try {
    const result = await new Promise<unknown>((resolve, reject) => { worker.once('message', resolve); worker.once('error', reject) })
    expect(result).toEqual({
      sharedInit: true, sharedFailure: true, originalErrors: [true, true],
      newAttempt: true, sharedRetry: true, cachedSuccess: true,
      attempts: 2, snapshotBytes: expect.any(Number),
    })
    expect((result as { snapshotBytes: number }).snapshotBytes).toBeGreaterThan(0)
  } finally { await worker.terminate() }
})

it('Rapier 的起始作者接口与模拟起始版本一致；登记文件不带导入，构建脚本才能用原生 Node 直接加载', () => {
  expect(Object.values(AUTHOR_LIBRARIES['@dimforge/rapier3d-deterministic-compat']).every(release => release.minApiVersion === CODE_AUTHOR_SIMULATION_MIN_API_VERSION)).toBe(true)
  expect(readFileSync(path.resolve(__dirname, '../../../core/videoEdit/codeMaterial/authorLibraries.ts'), 'utf8')).not.toMatch(/^\s*import\s/m)
})
