import { existsSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { DEFAULT_LLM_CAPABILITIES } from '../../src/llm/defaults'
import {
  applyLlmModelCatalogEntry,
  findLlmModelCatalogEntry,
  normalizeCatalogModelId,
} from '../../src/llm/modelCatalog'
import { LLM_MODEL_CATALOG_ENTRIES } from '../../src/llm/modelCatalogEntries'

/**
 * 迁入 SDK 后 `entry.docs` 从仓库根相对路径改成了包内相对路径（`docs/llm-adaptation/...`，
 * 不带 `packages/ai-sdk/` 前缀，见任务 4.1 执行记录），这里的基准目录相应从仓库根改成包根。
 * `__dirname` 是 `packages/ai-sdk/tests/llm`，上两级就是包根 `packages/ai-sdk`。
 */
const PACKAGE_ROOT = path.resolve(__dirname, '../..')

describe('normalizeCatalogModelId', () => {
  it('去掉聚合网关的厂商前缀', () => {
    expect(normalizeCatalogModelId('deepseek/deepseek-v4-flash')).toBe('deepseek-v4-flash')
    expect(normalizeCatalogModelId('xiaomimimo/mimo-v2.5-pro')).toBe('mimo-v2.5-pro')
  })

  it('去掉快照日期与档位标记，保留真正的模型变体后缀', () => {
    expect(normalizeCatalogModelId('doubao-seed-2-1-pro-260628')).toBe('doubao-seed-2-1-pro')
    expect(normalizeCatalogModelId('qwen3.7-max-2026-06-08')).toBe('qwen3.7-max')
    expect(normalizeCatalogModelId('kimi-k3:free')).toBe('kimi-k3')
    expect(normalizeCatalogModelId('MiniMax-M3')).toBe('minimax-m3')
    // -vision-exp / -turbo / -preview 是不同模型，不能当成快照后缀剃掉
    expect(normalizeCatalogModelId('deepseek-v4-flash-vision-exp')).toBe('deepseek-v4-flash-vision-exp')
    expect(normalizeCatalogModelId('glm-5v-turbo')).toBe('glm-5v-turbo')
  })
})

describe('findLlmModelCatalogEntry', () => {
  it('同一个模型不管从哪个渠道进来都查到同一条', () => {
    const direct = findLlmModelCatalogEntry('deepseek-v4-flash')
    expect(direct?.id).toBe('deepseek-v4-flash')
    expect(findLlmModelCatalogEntry('deepseek/deepseek-v4-flash')).toBe(direct)
  })

  it('支持别名（同能力的价格变体）', () => {
    expect(findLlmModelCatalogEntry('qwen3.8-max-prime')?.id).toBe('qwen3.8-max')
  })

  it('查不到的模型返回 null，不做任何猜测', () => {
    expect(findLlmModelCatalogEntry('some-unknown-model-v9')).toBeNull()
    expect(findLlmModelCatalogEntry('')).toBeNull()
  })
})

describe('applyLlmModelCatalogEntry', () => {
  it('按目录标好输入模态与上下文，通用能力保持基础值', () => {
    const entry = findLlmModelCatalogEntry('mimo-v2.5')
    expect(entry).not.toBeNull()
    const capabilities = applyLlmModelCatalogEntry(DEFAULT_LLM_CAPABILITIES, entry!)
    expect(capabilities).toMatchObject({
      text: true,
      image: true,
      video: true,
      audio: true,
      toolCall: true,
      // streaming / usage 是所有 OpenAI 兼容供应商都成立的通用能力，不在每条数据里重复写
      streaming: DEFAULT_LLM_CAPABILITIES.streaming,
      usage: DEFAULT_LLM_CAPABILITIES.usage,
    })
  })

  it('结构化输出模式与 jsonOutput 保持一致', () => {
    const entry = findLlmModelCatalogEntry('kimi-k3')!
    const capabilities = applyLlmModelCatalogEntry(DEFAULT_LLM_CAPABILITIES, entry)
    expect(capabilities.structuredOutputMode).toBe('schema')
    expect(capabilities.jsonOutput).toBe(true)
    // 官方把 temperature/top_p 列为固定值并要求不要显式传入
    expect(capabilities.sampling).toBe(false)
  })

  it('只在本项目当前协议下可用的模态才算支持', () => {
    // DeepSeek 的视觉模型只在 Responses API 上收图，本项目还没有那条协议；
    // 走 Chat Completions 发图会被静默替换成占位文本，所以必须保持未勾选。
    const entry = findLlmModelCatalogEntry('deepseek-v4-flash-vision-exp')!
    expect(entry.input.image).toBe(false)
    expect(entry.note).toContain('Responses API')
    // GLM-5.3 官方明确只支持文本模态
    expect(findLlmModelCatalogEntry('glm-5.3')!.input).toEqual({ image: false, video: false, audio: false })
  })
})

describe('目录数据自身的约束', () => {
  it('id 已经是规范化形式且互不重复', () => {
    const ids = LLM_MODEL_CATALOG_ENTRIES.map(entry => entry.id)
    for (const id of ids) {
      expect(normalizeCatalogModelId(id)).toBe(id)
    }
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('每条都能追溯到仓库里真实存在的资料文件', () => {
    for (const entry of LLM_MODEL_CATALOG_ENTRIES) {
      expect(existsSync(path.join(PACKAGE_ROOT, entry.docs)), `${entry.id} -> ${entry.docs}`).toBe(true)
    }
  })
})
