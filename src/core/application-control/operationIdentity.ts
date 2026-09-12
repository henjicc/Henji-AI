import { v5 as uuidV5 } from 'uuid'

/** 外部操作的生成任务使用独立 UUID 命名空间，兼容原生文件与任务标识契约。 */
export function applicationGenerationTaskId(operationId: string): string {
  return uuidV5(`henji:mcp:generation:${operationId}`, uuidV5.URL)
}
