import { build } from 'esbuild'
import path from 'node:path'
import type { Plugin } from 'vite'

const MODULE_ID = 'virtual:henji-replay-main-world'

/** executeInMainWorld 会序列化函数，因此所有页面依赖必须留在同一个函数体内。 */
export function replayMainWorld(): Plugin {
  return {
    name: 'henji:replay-main-world',
    resolveId(id) { if (id === MODULE_ID) return `\0${MODULE_ID}` },
    async load(id) {
      if (id !== `\0${MODULE_ID}`) return
      const bundle = await build({
        entryPoints: [path.resolve('packages/web-replay-probe/src/replay/mainWorld.ts')],
        bundle: true, write: false, format: 'iife', globalName: 'replayModule', platform: 'browser', target: 'es2022', metafile: true,
      })
      for (const file of Object.keys(bundle.metafile!.inputs)) this.addWatchFile(path.resolve(file))
      return `export default function installReplayMainWorld(host) {\n${bundle.outputFiles[0].text}\nreplayModule.install(host);\n}`
    },
  }
}
