import { app } from 'electron'

import { verifyModelCapabilities } from '../services/llm/sdk/capability-smoke'
import { loadStoredLlmConfigForCli, saveStoredLlmConfigForCli } from './runner'
import type { ModelCapabilitySmokeResult } from '../../../src/core/llm/capabilitySmoke'

/**
 * 从真实探测结果推导能力标志。
 *
 * 渲染层有 `applyCapabilitySmokeToCapabilities` 做同样的事，但它经 `src/core/llm/types.ts`
 * 依赖 `@/` 别名——那个别名只在渲染层配置，主进程拉进来 tsc 直接报 TS2307。所以这里按同一
 * 语义就地推导，只认 passed，不猜。
 */
function capabilitiesFromSmoke<T extends Record<string, unknown>>(
  current: T,
  result: ModelCapabilitySmokeResult
): T {
  const passed = (id: string): boolean => (
    result.checks.some((check) => check.id === id && check.status === 'passed')
  )
  return {
    ...current,
    text: passed('text'),
    streaming: passed('streaming'),
    usage: passed('usage'),
    toolCall: passed('toolCall'),
    jsonOutput: passed('structuredOutput'),
    structuredOutputMode: passed('structuredOutput') ? 'json' : 'none',
  }
}

/**
 * 无界面的模型能力验证入口。
 *
 * 存在的理由：`verifyModelCapabilities` 原本只能从设置界面触发，于是"换一个供应商能不能用"
 * 这件事每迭代一次就要人去点一次按钮。接一个新供应商时请求体往往要试几轮才对得上，人肉点
 * 按钮把这个循环拖到几分钟一轮，而且拿不到失败时的请求正文。
 *
 * 用法：npm run llm:verify -- --provider mimo --model mimo-v2.5
 */
export async function runAssistantModelVerification(argv: string[]): Promise<number> {
  const readArg = (name: string): string | undefined => {
    const index = argv.indexOf(`--${name}`)
    const value = index >= 0 ? argv[index + 1] : undefined
    return value && !value.startsWith('--') ? value : undefined
  }
  const write = (record: Record<string, unknown>): void => {
    process.stdout.write(`${JSON.stringify(record)}\n`)
  }

  try {
    const config = await loadStoredLlmConfigForCli()
    const profile = config.agentProfiles.find((item) => item.id === config.selectedAgentProfileId)
      ?? config.agentProfiles[0]
    const providerId = readArg('provider') ?? profile?.primary.providerId
    const modelId = readArg('model') ?? profile?.primary.modelId
    if (!providerId || !modelId) throw new Error('缺少 --provider 或 --model，且当前档案没有主模型')

    const model = config.models.find((item) => (
      item.providerId === providerId && item.modelId === modelId
    ))
    if (!model) throw new Error(`配置中没有模型 ${providerId}/${modelId}`)

    const result = await verifyModelCapabilities({
      requestId: `verify-${providerId}-${modelId}`,
      providerId,
      modelId,
      adapter: model.adapter,
      baseUrl: model.baseUrl,
      apiProtocol: model.apiProtocol,
      // 探测用 json 模式：schema 模式要求供应商原生支持，接新家时先问最低要求。
      structuredOutputMode: 'json',
      declaredInputModalities: {
        image: model.capabilities.image,
        video: model.capabilities.video,
        audio: model.capabilities.audio,
      },
    })
    write({ type: 'verification', providerId, modelId, result })

    /*
     * --save 复用设置界面同一套写入逻辑（applyCapabilitySmokeToCapabilities），不手写验证记录。
     * 运行时只认真实探测过的能力，所以这份记录必须来自刚才那次真调用，不能是人填的。
     */
    if (argv.includes('--save')) {
      const key = `${providerId}::${modelId}`
      await saveStoredLlmConfigForCli({
        ...config,
        models: config.models.map((item) => (
          `${item.providerId}::${item.modelId}` === key
            ? {
                ...item,
                capabilities: capabilitiesFromSmoke(item.capabilities, result),
              }
            : item
        )),
        agentProfiles: config.agentProfiles.map((item) => (
          item.id === profile?.id
            ? {
                ...item,
                verifications: [
                  ...item.verifications.filter((v) => `${v.providerId}::${v.modelId}` !== key),
                  result,
                ],
                updatedAt: new Date().toISOString(),
              }
            : item
        )),
      })
      write({ type: 'saved', providerId, modelId })
    }

    const failed = result.checks.filter((check) => check.status === 'failed')
    return failed.length > 0 ? 1 : 0
  } catch (error) {
    write({ type: 'error', message: error instanceof Error ? error.message : String(error) })
    return 1
  } finally {
    app.quit()
  }
}

