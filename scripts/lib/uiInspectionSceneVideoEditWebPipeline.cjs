const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { build } = require('esbuild')
const { assignIsolatedMcpPort } = require('./uiInspectionMcpClient.cjs')

const ROOT = path.resolve(__dirname, '../..')
const SOURCE = 'electron/main/services/web-source'

/** 同一次运行里的旧方式对照：取提交里的网页来源目录，其余依赖仍用当前源码。 */
function headSourcePlugin(headRoot) {
  return {
    name: 'head-web-source',
    setup(context) {
      context.onResolve({ filter: /web-source\/page$/ }, args => args.importer.includes('webSourcePipelineProbe') ? { path: path.join(headRoot, SOURCE, 'page.ts') } : undefined)
      context.onResolve({ filter: /^\.\.?\// }, args => {
        if (!args.importer.startsWith(headRoot)) return undefined
        const mirrored = path.resolve(path.dirname(args.importer).replace(headRoot, ROOT), args.path)
        if (mirrored.startsWith(path.join(ROOT, SOURCE) + path.sep)) return undefined
        for (const candidate of [mirrored, `${mirrored}.ts`, path.join(mirrored, 'index.ts')]) if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return { path: candidate }
        return undefined
      })
    },
  }
}

function createVideoEditWebPipelineScene() {
  return {
    id: 'video-edit-web-pipeline', surface: '剪辑', name: '剪辑-网页取帧流水线', writesUserData: false,
    async setup(page, app) {
      await assignIsolatedMcpPort(page)
      const output = path.resolve(ROOT, '.tmp/web-source-pipeline')
      fs.rmSync(output, { recursive: true, force: true })
      fs.mkdirSync(path.join(output, 'main'), { recursive: true })
      fs.mkdirSync(path.join(output, 'preload'), { recursive: true })
      fs.copyFileSync(path.resolve(ROOT, 'out/preload/web-replay.cjs'), path.join(output, 'preload/web-replay.cjs'))
      const headRoot = path.join(output, 'head')
      for (const file of execFileSync('git', ['-C', ROOT, 'ls-tree', '-r', '--name-only', 'HEAD', SOURCE], { encoding: 'utf8' }).split(/\s+/).filter(Boolean)) {
        fs.mkdirSync(path.dirname(path.join(headRoot, file)), { recursive: true })
        fs.writeFileSync(path.join(headRoot, file), execFileSync('git', ['-C', ROOT, 'show', `HEAD:${file}`]))
      }
      const entry = path.join(ROOT, 'scripts/lib/webSourcePipelineProbe.ts')
      await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', packages: 'external', outfile: path.join(output, 'main/probe.cjs') })
      await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', packages: 'external', outfile: path.join(output, 'main/probe-head.cjs'), plugins: [headSourcePlugin(headRoot)] })
      await build({ entryPoints: [path.join(ROOT, 'scripts/lib/webSourcePipelineReceiver.ts')], bundle: true, platform: 'browser', format: 'cjs', external: ['electron'], outfile: path.join(output, 'receiver.cjs') })
      // 两个包各带一份读回窗口的启动应答；同步应答只取第一个监听，后跑的包读回窗口起不来，会退回串行、测不到流水线。
      const run = (bundle, mode) => app.evaluate(async ({ ipcMain }, input) => {
        ipcMain.removeAllListeners('web-replay:boot')
        return process.mainModule.require(input.bundle).webSourcePipelineProbe(input.output, input.mode)
      }, { bundle: path.join(output, 'main', bundle), output, mode })
      const baseline = await run('probe-head.cjs', 'baseline')
      const report = await run('probe.cjs', 'pipeline')
      fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify({ baseline, pipeline: report }, null, 2))
      for (const row of report.cases) assert.equal(row.mismatched, 0, JSON.stringify(row))
      for (const row of report.cases.filter(row => row.depth === 3)) assert.ok(row.waits.p50Ms <= 10, JSON.stringify(row))
    },
  }
}

module.exports = { createVideoEditWebPipelineScene }
