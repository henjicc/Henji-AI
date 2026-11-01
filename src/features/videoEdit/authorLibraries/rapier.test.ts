import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { Worker } from 'node:worker_threads'
import { expect, it } from 'vitest'
import { AUTHOR_LIBRARIES } from '../../../core/videoEdit/codeMaterial/authorLibraries'

it('冻结 Rapier 的 init 失败向所有调用方传播，下一次可重试且成功后继续去重', async () => {
  const [release] = Object.values(AUTHOR_LIBRARIES['@dimforge/rapier3d-deterministic-compat'])
  const url = pathToFileURL(path.resolve(release.frozen!, 'rapier.mjs')).href
  const worker = new Worker(`
    const { parentPort } = require('node:worker_threads');
    (async () => {
      const instantiate = WebAssembly.instantiate;
      const failure = new Error('首次 Wasm 初始化失败');
      let attempts = 0;
      WebAssembly.instantiate = (...args) => ++attempts === 1
        ? Promise.reject(failure) : Reflect.apply(instantiate, WebAssembly, args);
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
