import { AiRuntimeError } from './errors'
import { evalFunction } from './js-runtime'
import type {
  BuiltRequest,
  EndpointConfigDsl,
  EndpointRuleDsl,
  JsonObject,
  JsonValue,
  ModelManifestItem,
  RequestConfigDsl,
  RequestFieldDsl,
  RequestTransformDsl,
} from './types'

const INTERNAL_PARAM_PREFIX = '__'

export function buildRequest(params: JsonObject, model?: ModelManifestItem): BuiltRequest {
  const route = resolveRoute(params, model)
  const method = resolveMethod(model)
  const body = buildBody(params, model)
  return { route, method, body }
}

function resolveRoute(params: JsonObject, model?: ModelManifestItem): string {
  const endpointDsl = model?.endpoints
  if (!endpointDsl) {
    return ''
  }

  if (endpointDsl.selectorJs) {
    const value = evalFunction(endpointDsl.selectorJs, params)
    if (typeof value !== 'string') {
      throw new AiRuntimeError('invalid_selector_result', 'Selector JS must return a string route')
    }
    return resolveNamedRoute(endpointDsl, value)
  }

  return selectEndpointFromDsl(params, endpointDsl)
}

function resolveMethod(model?: ModelManifestItem): string {
  return model?.endpoints?.method?.toUpperCase() ?? 'POST'
}

function buildBody(params: JsonObject, model?: ModelManifestItem): JsonValue {
  const requestDsl = model?.request
  if (!requestDsl) {
    return stripInternalParams(params)
  }

  if (requestDsl.builderJs) {
    return evalFunction(requestDsl.builderJs, params)
  }

  return applyRequestDsl(params, requestDsl)
}

function selectEndpointFromDsl(params: JsonObject, endpointDsl: EndpointConfigDsl): string {
  for (const rule of endpointDsl.rules ?? []) {
    if (matchesRule(params, rule)) {
      return resolveNamedRoute(endpointDsl, rule.route)
    }
  }
  return resolveNamedRoute(endpointDsl, endpointDsl.defaultRoute)
}

function resolveNamedRoute(endpointDsl: EndpointConfigDsl, route: string): string {
  return endpointDsl.routes?.[route]?.path ?? route
}

function matchesRule(params: JsonObject, rule: EndpointRuleDsl): boolean {
  if (!isJsonObject(rule.when)) {
    return false
  }
  return Object.entries(rule.when).every(([key, expected]) => params[key] === expected)
}

function applyRequestDsl(params: JsonObject, requestDsl: RequestConfigDsl): JsonValue {
  const output: JsonObject = { ...(requestDsl.constants ?? {}) }

  for (const field of requestDsl.fields ?? []) {
    if (!fieldShouldApply(params, field)) {
      continue
    }
    const value = getValue(params, field.from)
    if (value !== undefined) {
      output[field.to] = applyTransforms(value, field.transforms ?? [])
    }
  }

  for (const key of requestDsl.removeEmpty ?? []) {
    if (isEmpty(output[key])) {
      delete output[key]
    }
  }

  return output
}

function fieldShouldApply(params: JsonObject, field: RequestFieldDsl): boolean {
  if (!field.when || !isJsonObject(field.when)) {
    return true
  }
  return Object.entries(field.when).every(([key, expected]) => (getValue(params, key) ?? null) === expected)
}

function getValue(params: JsonObject, from: string): JsonValue | undefined {
  if (!from.includes('.')) {
    return params[from]
  }

  let current: JsonValue = params
  for (const part of from.split('.')) {
    if (!isJsonObject(current)) {
      return undefined
    }
    current = current[part]
    if (current === undefined) {
      return undefined
    }
  }
  return current
}

function applyTransforms(value: JsonValue, transforms: RequestTransformDsl[]): JsonValue {
  let next = value
  for (const transform of transforms) {
    next = applyTransform(next, transform)
  }
  return next
}

function applyTransform(value: JsonValue, transform: RequestTransformDsl): JsonValue {
  switch (transform.name) {
    case 'trim':
      return typeof value === 'string' ? value.trim() : ''
    case 'string':
      return typeof value === 'string' ? value : JSON.stringify(value)
    case 'number': {
      const numeric = typeof value === 'number' ? value : Number(typeof value === 'string' ? value : 0)
      return Number.isFinite(numeric) ? numeric : null
    }
    case 'boolean':
      return typeof value === 'boolean' ? value : false
    case 'join':
      return joinArray(value, transform)
    default:
      return value
  }
}

function joinArray(value: JsonValue, transform: RequestTransformDsl): JsonValue {
  if (!Array.isArray(value)) {
    return value
  }
  const separator = typeof transform.args?.separator === 'string' ? transform.args.separator : ','
  return value.map((item) => (typeof item === 'string' ? item : JSON.stringify(item))).join(separator)
}

function isEmpty(value: JsonValue | undefined): boolean {
  if (value === undefined || value === null) {
    return true
  }
  if (typeof value === 'string') {
    return value.trim().length === 0
  }
  if (Array.isArray(value)) {
    return value.length === 0
  }
  if (isJsonObject(value)) {
    return Object.keys(value).length === 0
  }
  return false
}

function stripInternalParams(params: JsonObject): JsonObject {
  return Object.fromEntries(
    Object.entries(params).filter(([key]) => !key.startsWith(INTERNAL_PARAM_PREFIX))
  )
}

function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
