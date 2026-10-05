/**
 * 自动化 / 隔离测试模式：由仓库统一启动器 `scripts/lib/electronLaunch.cjs` 启动（设置 `HENJI_AUTOMATION=1`），
 * 或使用隔离资料目录（`HENJI_ISOLATED_APP_DATA`）。正常启动的应用不处于此模式。
 *
 * 只给测试专用的能力把门（测试夹具 IPC `testFixtures:*`）。
 * preload 用同样的判断决定是否暴露 `henjiNative.testFixtures`。
 */
export function isAutomationTestMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return env['HENJI_AUTOMATION'] === '1' || Boolean(env['HENJI_ISOLATED_APP_DATA']?.trim())
}
