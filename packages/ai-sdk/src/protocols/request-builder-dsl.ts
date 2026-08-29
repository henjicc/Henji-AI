import { AiRuntimeError } from '../runtime/AiRuntimeError'
import type {
  ModelRuntimeDefinition,
  RuntimeEndpointConfig,
} from '../types/model'
import type { BuiltRequest, JsonObject } from '../types/runtime'

const INTERNAL_PARAM_PREFIX = '__'

/**
 * 直接调用 catalog 中的真实 endpoint selector 与 request builder。
 *
 * selector/builder 都允许返回 Promise；统一 await 可同时覆盖普通同步模型与 Fal
 * Seedream v4/v4.5 等既有异步 builder，不再经过字符串序列化或动态代码求值。
 */
export async function buildRequest(
  params: JsonObject,
  model: ModelRuntimeDefinition | undefined
): Promise<BuiltRequest> {
  const endpoint = await resolveRequestEndpoint(params, model)
  const body = await buildBody(params, model)
  return {
    route: endpoint.route,
    method: endpoint.method,
    body,
  }
}

export interface ResolvedEndpoint {
  route: string
  method: string
}

/** 续查任务只需要路由；不应为了轮询再执行一遍可能有严格输入校验的生成 builder。 */
export async function resolveRequestEndpoint(
  params: JsonObject,
  model: ModelRuntimeDefinition | undefined
): Promise<ResolvedEndpoint> {
  const endpoints: RuntimeEndpointConfig | undefined = model?.endpoints
  if (typeof endpoints === 'string') {
    return { route: endpoints, method: 'POST' }
  }
  if (!endpoints) {
    return { route: '', method: 'POST' }
  }

  if (endpoints.selector) {
    const selected = await endpoints.selector(params)
    if (typeof selected !== 'string') {
      throw new AiRuntimeError('invalid_selector_result', 'Endpoint selector must return a string route')
    }
    return resolveNamedRoute(endpoints, selected)
  }

  for (const rule of endpoints.rules ?? []) {
    if (matchesRule(params, rule.when)) {
      return resolveNamedRoute(endpoints, rule.endpoint)
    }
  }
  return resolveNamedRoute(endpoints, endpoints.default ?? '')
}

function resolveNamedRoute(
  endpoints: Exclude<RuntimeEndpointConfig, string>,
  selected: string
): ResolvedEndpoint {
  const named = endpoints.routes?.[selected]
  return {
    route: named?.path ?? selected,
    method: named?.method?.toUpperCase() ?? 'POST',
  }
}

function matchesRule(params: JsonObject, expected: JsonObject): boolean {
  return Object.entries(expected).every(([key, value]) => params[key] === value)
}

async function buildBody(
  params: JsonObject,
  model: ModelRuntimeDefinition | undefined
): Promise<JsonObject> {
  const request = model?.request
  const preparedParams = request?.preprocess?.(params) ?? params
  if (request?.builder) {
    return await request.builder(preparedParams)
  }
  return {
    ...(request?.base ?? {}),
    ...stripInternalParams(preparedParams),
  }
}

function stripInternalParams(params: JsonObject): JsonObject {
  return Object.fromEntries(
    Object.entries(params).filter(([key]) => !key.startsWith(INTERNAL_PARAM_PREFIX))
  )
}
