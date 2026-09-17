import type { McpPlatform } from '@/core/application-control/localHostContracts'

export function createElectronMcp(): McpPlatform {
  const native = (): McpPlatform => {
    const api = window.henjiNative?.mcp as McpPlatform | undefined
    if (!api) throw new Error('外部连接功能需要桌面应用，请重新启动应用。')
    return api
  }
  return {
    status: () => native().status(), configure: (input) => native().configure(input), authorize: (input) => native().authorize(input),
    revoke: (input) => native().revoke(input), connectionConfig: (input) => native().connectionConfig(input),
  }
}
