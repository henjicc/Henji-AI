import { buildEmbeddedPromptContext } from '../../../src/core/assistant/embeddedAgent'
import type { WebContents } from 'electron'
import { getApplicationRuntime } from '../services/application-runtime/runtime'
import { getDocumentService } from '../services/documents/runtime'
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
    if (!options.freshProject) return await runEmbeddedCli(options, buildEmbeddedPromptContext(host.getContext()!), write)
    const project = await getDocumentService().createProject({ name: options.freshProject })
    write({ type: 'project_created', projectId: project.id, name: project.name })
    try {
      return await runEmbeddedCli(options, buildEmbeddedPromptContext(host.getContext()!), write)
    } finally {
      // 助手最后一次修改的自动保存还可能在写项目里的文件，等它落盘再整个移走。
      await new Promise<void>(resolve => setTimeout(resolve, 3_000))
      try {
        await getDocumentService().trashProject(project.id)
        write({ type: 'project_trashed', projectId: project.id })
      } catch (error) {
        logger.warn('测量用项目没能移进回收区', { event: 'assistant_cli.fresh_project.trash_failed', error, context: { projectId: project.id } })
        write({ type: 'project_trash_failed', projectId: project.id, message: error instanceof Error ? error.message : String(error) })
      }
    }
  } catch (error) {
    logger.error('命令行助手运行失败', { event: 'assistant_cli.run.failed', error })
    write({ type: 'error', message: error instanceof Error ? error.message : '命令行助手运行失败' })
    return 1
  }
}
