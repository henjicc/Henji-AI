const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')
const { PACKAGED_EXECUTABLE_ENV, resolveLaunchTarget } = require('./electronLaunchTarget.cjs')

const base = { defaultExecutable: '/repo/node_modules/electron/dist/electron', mainEntry: '/repo/out/main/index.cjs', cwd: '/repo' }

test('默认启动仓库 Electron + 主入口或 appPath，工作目录不变', () => {
  assert.deepEqual(resolveLaunchTarget({ ...base, env: {} }), {
    packaged: false, executable: base.defaultExecutable, entryArgs: [base.mainEntry], cwd: '/repo',
  })
  assert.deepEqual(resolveLaunchTarget({ ...base, appPath: '/repo', env: { [PACKAGED_EXECUTABLE_ENV]: '  ' } }).entryArgs, ['/repo'])
})

test('参数或环境变量指定打包产物：不传入口，工作目录为可执行文件目录，参数优先于环境变量', () => {
  const exe = path.resolve('/release/win-unpacked/app.exe')
  const exists = (file) => file === exe
  assert.deepEqual(resolveLaunchTarget({ ...base, executablePath: exe, env: { [PACKAGED_EXECUTABLE_ENV]: '/other.exe' }, exists }), {
    packaged: true, executable: exe, entryArgs: [], cwd: path.dirname(exe),
  })
  assert.equal(resolveLaunchTarget({ ...base, env: { [PACKAGED_EXECUTABLE_ENV]: exe }, exists }).executable, exe)
  assert.throws(() => resolveLaunchTarget({ ...base, env: { [PACKAGED_EXECUTABLE_ENV]: '/missing.exe' }, exists }), /HENJI_ELECTRON_EXECUTABLE/)
})
