/**
 * 本机正式构建：用与安装包相同的生产产物（out/，非开发服务器、无 StrictMode 双挂载、无按需依赖预构建）
 * 启动应用并使用真实资料目录。交给用户测试、或结论依赖“与正式安装版一致”时用它，而不是 electron:dev。
 *
 *   npm run electron:prod                 先 electron:bundle 再启动
 *   npm run electron:prod -- --skip-build 产物已是最新时直接启动
 *   其余参数原样传给应用（如 --background、--dev-skip-onboarding）
 *
 * 运行期间登记为开发实例（与 electron:dev 同一份登记），electron:bundle 会拒绝改写它正在加载的 out/。
 */
const { spawn, spawnSync } = require('node:child_process')
const path = require('node:path')
const { clearElectronDevState, writeElectronDevState } = require('./lib/electronDevState.cjs')

const root = path.resolve(__dirname, '..')
const args = process.argv.slice(2)
const skipBuild = args.includes('--skip-build')
const appArgs = args.filter(arg => arg !== '--skip-build')

if (!skipBuild) {
  const build = spawnSync(process.execPath, [path.join(root, 'scripts/run-electron-bundle.cjs')], { cwd: root, stdio: 'inherit' })
  if (build.status !== 0) process.exit(build.status ?? 1)
}

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
const electron = require('electron')
const child = spawn(electron, [root, ...appArgs], { cwd: root, env, stdio: 'inherit' })

writeElectronDevState(root)
process.on('exit', () => clearElectronDevState(root))
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { child.kill(); process.exit(0) })

child.on('exit', (code, signal) => {
  if (signal) { process.kill(process.pid, signal); return }
  process.exit(code ?? 0)
})
