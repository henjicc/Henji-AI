import { startRelay } from './services/mcp/relay'
import { RELAY_PORT_ENV, RELAY_SECRET_ENV, relayBuildOf } from './services/mcp/relayProtocol'

// 外部智能体连接的接线员进程入口：由痕迹以 Electron 的 Node 模式拉起，脱离痕迹的进程树独立常驻。
const port = Number(process.env[RELAY_PORT_ENV])
const secret = process.env[RELAY_SECRET_ENV]
delete process.env[RELAY_PORT_ENV]
delete process.env[RELAY_SECRET_ENV]

if (!secret || !Number.isInteger(port) || port <= 0) {
  process.exitCode = 2
} else {
  // 端口已被占用（另一个接线员抢先启动）时直接退出，同一端口只留一个接线员。
  startRelay({ port, secret, build: relayBuildOf(__filename), onExit: () => process.exit(0) }).catch(() => process.exit(1))
}
