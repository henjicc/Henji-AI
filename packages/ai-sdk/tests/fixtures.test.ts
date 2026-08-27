import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import * as apimart from '../src/providers/apimart'
import * as bailian from '../src/providers/bailian'
import {
  buildApiMartEndpoints,
  markApiMartEndpointReachable,
  resetApiMartEndpointPreference,
} from '../src/providers/endpoints/apimart'
import {
  buildGrsaiEndpoints,
  markGrsaiEndpointReachable,
  resetGrsaiEndpointPreference,
} from '../src/providers/endpoints/grsai'
import * as fal from '../src/providers/fal'
import * as grsai from '../src/providers/grsai'
import * as kie from '../src/providers/kie'
import * as modelscope from '../src/providers/modelscope'
import * as ppio from '../src/providers/ppio'
import * as volcengine from '../src/providers/volcengine'
import type { JsonValue } from '../src/types/runtime'
import { fakeRuntimeContext } from './providers/test-helpers'

/**
 * fixture 驱动的供应商回归测试（任务 6.1）。
 *
 * 每个 `tests/fixtures/<供应商>/*.json` 覆盖两个方向：
 * - 正向（仅 `phase: "execute"` 且带 `expectedRequest` 的 fixture）：给定 `params` 作为
 *   `input.body`，断言 provider 实际发到 `fetch` 的 URL/方法/请求体（含 provider 在发送边界做的
 *   强制覆盖，如 APIMart 的 `nsfw_check`、Grsai 的 `replyType`）。
 * - 反向（全部 fixture）：给定 `response` 作为 mock 的 HTTP 响应体，断言 `execute`/`continuePolling`
 *   最终解析出的状态、结果 URL 或错误码/错误信息，与 KIE 的 `resultJson` 二次解析、深度遍历
 *   `resultObject` 等复杂分支都在这一侧覆盖。
 *
 * 详见 tests/fixtures/README.md。
 */

interface ProviderAdapter {
  execute: typeof kie.execute
  continuePolling: typeof kie.continuePolling
}

interface EndpointPreference {
  markReachable: string
  expectedOrder: string[]
}

interface ExpectedRequest {
  url: string
  method?: string
  body?: JsonValue
}

interface ExpectedOutcome {
  outcome: 'resolve' | 'reject'
  status?: 'pending' | 'completed'
  url?: string
  taskId?: string
  errorCode?: string
  errorMessageIncludes?: string
}

interface Fixture {
  provider: string
  modelId: string
  scenario: string
  phase: 'execute' | 'continuePolling'
  method?: string
  route: string
  taskId?: string
  params?: JsonValue
  expectedRequest?: ExpectedRequest
  response: JsonValue
  responseStatus?: number
  expected: ExpectedOutcome
  endpointPreference?: EndpointPreference
  skipRequestAssertion?: boolean
}

const PROVIDERS: Record<string, ProviderAdapter> = {
  kie,
  fal,
  apimart,
  grsai,
  ppio,
  modelscope,
  bailian,
  volcengine,
}

const FIXTURES_DIR = resolve(__dirname, 'fixtures')

function loadFixtures(): Array<{ provider: string; file: string; fixture: Fixture }> {
  const entries: Array<{ provider: string; file: string; fixture: Fixture }> = []
  for (const provider of Object.keys(PROVIDERS)) {
    const providerDir = resolve(FIXTURES_DIR, provider)
    let files: string[]
    try {
      files = readdirSync(providerDir).filter((name) => name.endsWith('.json'))
    } catch {
      files = []
    }
    for (const file of files) {
      const raw = readFileSync(resolve(providerDir, file), 'utf-8')
      entries.push({ provider, file, fixture: JSON.parse(raw) as Fixture })
    }
  }
  return entries
}

function jsonResponse(payload: JsonValue, status: number): Response {
  return new Response(payload === null ? 'null' : JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const allFixtures = loadFixtures()

describe('provider fixtures 回归测试', () => {
  afterEach(() => {
    resetApiMartEndpointPreference()
    resetGrsaiEndpointPreference()
  })

  it('fixtures 目录下每个供应商至少有 3 个场景', () => {
    for (const provider of Object.keys(PROVIDERS)) {
      const count = allFixtures.filter((entry) => entry.provider === provider).length
      expect(count, `${provider} 应至少有 3 个 fixture`).toBeGreaterThanOrEqual(3)
    }
  })

  it('KIE 至少有 4 个结果解析边界场景', () => {
    const boundaryCount = allFixtures.filter(
      (entry) => entry.provider === 'kie' && entry.fixture.scenario.startsWith('boundary-')
    ).length
    expect(boundaryCount).toBeGreaterThanOrEqual(4)
  })

  it('APIMart 与 Grsai 各有一个多域名切换场景', () => {
    for (const provider of ['apimart', 'grsai']) {
      const hasDomainFixture = allFixtures.some(
        (entry) => entry.provider === provider && entry.fixture.scenario === 'domain-fallback'
      )
      expect(hasDomainFixture, `${provider} 缺少 domain-fallback fixture`).toBe(true)
    }
  })

  it.each(allFixtures.map((entry) => [`${entry.provider}/${entry.file}`, entry] as const))(
    '%s 正反双向断言',
    async (_label, entry) => {
      const { provider, fixture } = entry
      const adapter = PROVIDERS[provider]

      if (fixture.endpointPreference) {
        if (provider === 'apimart') markApiMartEndpointReachable(fixture.endpointPreference.markReachable)
        else if (provider === 'grsai') markGrsaiEndpointReachable(fixture.endpointPreference.markReachable)

        const buildEndpoints = provider === 'apimart' ? buildApiMartEndpoints : buildGrsaiEndpoints
        expect(buildEndpoints(fixture.route)).toEqual(fixture.endpointPreference.expectedOrder)
      }

      // 用 mockImplementation 而不是 mockResolvedValue：Response.json() 每个实例只能读一次，
      // Fal 的 continuePolling 对同一个 taskId 会发起两次 fetch（先查 status 再取 result），
      // 复用同一个 Response 对象会在第二次读 body 时抛 "Body has already been read"。
      const fetchMock = vi.fn().mockImplementation(
        async () => jsonResponse(fixture.response, fixture.responseStatus ?? 200)
      )
      const runtime = fakeRuntimeContext(fetchMock)

      const call = fixture.phase === 'execute'
        ? adapter.execute({
          apiKey: 'fixture-api-key',
          route: fixture.route,
          method: fixture.method ?? 'POST',
          body: fixture.params ?? {},
          requestId: `fixture-${provider}-${fixture.scenario}`,
          runtime,
        })
        : adapter.continuePolling({
          apiKey: 'fixture-api-key',
          route: fixture.route,
          taskId: fixture.taskId ?? 'fixture-task-id',
          requestId: `fixture-${provider}-${fixture.scenario}-poll`,
          polling: { interval: 0, maxAttempts: 1 },
          runtime,
        })

      // 反向：response -> 解析结果
      if (fixture.expected.outcome === 'resolve') {
        const matcher: Record<string, unknown> = { status: fixture.expected.status }
        if (fixture.expected.url !== undefined) matcher.url = fixture.expected.url
        if (fixture.expected.taskId !== undefined) matcher.taskId = fixture.expected.taskId
        await expect(call).resolves.toMatchObject(matcher)
      } else {
        const matcher: Record<string, unknown> = {}
        if (fixture.expected.errorCode !== undefined) matcher.code = fixture.expected.errorCode
        if (fixture.expected.errorMessageIncludes !== undefined) {
          matcher.message = expect.stringContaining(fixture.expected.errorMessageIncludes)
        }
        await expect(call).rejects.toMatchObject(matcher)
      }

      // 正向：params -> 实际发送的请求
      if (!fixture.skipRequestAssertion && fixture.expectedRequest) {
        expect(fetchMock).toHaveBeenCalled()
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
        expect(url).toBe(fixture.expectedRequest.url)
        if (fixture.expectedRequest.method) {
          expect(init.method).toBe(fixture.expectedRequest.method)
        }
        if (fixture.expectedRequest.body !== undefined) {
          expect(JSON.parse(String(init.body))).toEqual(fixture.expectedRequest.body)
        }
      }
    }
  )
})
