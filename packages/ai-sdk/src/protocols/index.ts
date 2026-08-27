/**
 * 供应商间可复用的请求/轮询协议模板：异步任务轮询驱动、请求体 DSL 构建、
 * `runtimeConstraints` 请求体规范化。
 */
export {
  POLL_QUERY_FAILED,
  ensureNotCancelled,
  pollUntilResult,
  waitIntervalMs,
  type PollLoopInput,
  type PollStepResult,
} from './polling'
export { buildRequest } from './request-builder-dsl'
export { normalizeRequestBody } from './request-normalizer'
