import type { WebContents } from 'electron'
import { getApplicationRuntime } from '../services/application-runtime/runtime'
import { createMainLogger } from '../services/logging'
import type { AssistantCliOptions } from './arguments'
import { runEmbeddedCli } from './embedded-runner'

const logger = createMainLogger('main.assistant_cli')
export async function runAssistantCli(owner: WebContents, options: AssistantCliOptions): Promise<number> {
  const write = (record: { type: string; [key: string]: unknown }): void => { process.stdout.write(`${JSON.stringify(record)}\n`) }
  try {
    const { host } = getApplicationRuntime()
    const deadline = Date.now() + 30_000
    while (!host.ready || !host.getContext()?.uiReady) {
      if (owner.isDestroyed()) throw new Error('应用宿主已退出')
      if (Date.now() >= deadline) throw new Error('等待应用宿主初始化超时')
      await new Promise<void>(resolve => setTimeout(resolve, 100))
    }
    const context = host.getContext()!
    return await runEmbeddedCli(options, JSON.stringify({ workspace: context.workspace, project: context.project, surface: context.surface }), write)
  } catch (error) {
    logger.error('命令行助手运行失败', { event: 'assistant_cli.run.failed', error })
    write({ type: 'error', message: error instanceof Error ? error.message : '命令行助手运行失败' })
    return 1
  }
}
