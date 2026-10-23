import { buildEmbeddedPromptContext } from '../../../src/core/assistant/embeddedAgent'
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
      if (Date.now() >= deadline) throw new Error(`等待应用宿主初始化超时（宿主${host.ready ? '已注册' : '未注册'}，界面上下文${host.getContext() ? (host.getContext()!.uiReady ? '已就绪' : '未就绪') : '未发布'}）`)
      await new Promise<void>(resolve => setTimeout(resolve, 100))
    }
    const context = host.getContext()!
    return await runEmbeddedCli(options, buildEmbeddedPromptContext(context), write)
  } catch (error) {
    logger.error('命令行助手运行失败', { event: 'assistant_cli.run.failed', error })
    write({ type: 'error', message: error instanceof Error ? error.message : '命令行助手运行失败' })
    return 1
  }
}
