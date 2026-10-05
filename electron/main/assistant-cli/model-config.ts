import fs from 'node:fs/promises'
import { z } from 'zod'
import { llmModelConfigSchema, llmProfileSchema } from '../../../src/core/llm/configSchema'
import { getProgramFilePath } from '../services/appPaths'

const storedLlmConfigSchema = z.object({
  providers: z.array(z.object({
    providerId: z.string().min(1),
    enabled: z.boolean(),
    reasoning: z.object({
      enabled: z.boolean(),
      effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']),
    }).optional(),
  }).passthrough()).min(1),
  models: z.array(llmModelConfigSchema).min(1),
  agentProfiles: z.array(llmProfileSchema).min(1),
  selectedAgentProfileId: z.string().min(1).optional(),
}).passthrough()
type StoredLlmConfig = z.infer<typeof storedLlmConfigSchema>

export async function loadStoredLlmConfigForCli(): Promise<StoredLlmConfig> {
  return await loadLlmConfig()
}

/** 与 `llm/provider-settings-storage.ts` 同一份程序目录配置。 */
function resolveLlmConfigPath(): string {
  return getProgramFilePath('llm-config.json')
}

export async function saveStoredLlmConfigForCli(config: StoredLlmConfig): Promise<void> {
  const filePath = resolveLlmConfigPath()
  await fs.writeFile(filePath, `${JSON.stringify(storedLlmConfigSchema.parse(config), null, 2)}\n`, 'utf8')
}

async function loadLlmConfig(): Promise<StoredLlmConfig> {
  const filePath = resolveLlmConfigPath()
  try {
    const raw = JSON.parse(await fs.readFile(filePath, 'utf8')) as unknown
    return storedLlmConfigSchema.parse(raw)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`未找到大语言模型配置：${filePath}。请先在应用设置中保存智能助手模型配置。`)
    }
    throw new Error(`读取大语言模型配置失败：${filePath}`, { cause: error })
  }
}

