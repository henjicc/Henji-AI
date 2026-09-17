import { v5 as uuidV5 } from 'uuid'

/** 幂等键只在调用者内唯一；领域任务使用可信宿主派生的全局操作身份。 */
export function applicationInvocationId(callerId: string, idempotencyKey: string): string {
  return uuidV5(JSON.stringify(['henji:application:invocation', callerId, idempotencyKey]), uuidV5.URL)
}

/** 应用操作的生成任务使用独立 UUID 命名空间。 */
export function applicationGenerationTaskId(operationId: string): string {
  return uuidV5(`henji:application:generation:${operationId}`, uuidV5.URL)
}
