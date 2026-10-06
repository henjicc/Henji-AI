import { BUILTIN_APPLICATION_CAPABILITY_REGISTRY } from '@/core/application-control/builtinApplicationCapabilityRegistry'

import type { ApplicationCapabilityHandlerRegistrar } from './handlerTypes'

export function parseCapabilityInput<TInput>(id: string, input: unknown): TInput {
  const definition = BUILTIN_APPLICATION_CAPABILITY_REGISTRY.get(id)
  if (!definition) throw new Error('NOT_FOUND')
  return definition.inputSchema.parse(input) as TInput
}

export function throwIfCapabilityAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new Error('ABORTED')
}

/*
 * 工具文档 ID 的公共叫法（项目体系 4.3）：能力契约里，一份画布 / 镜头参考文档的 ID 一律叫 `documentId`
 * （“项目”只指装文档的总项目）。画布、镜头参考、画布生成的领域服务内部仍用 `projectId` 指同一个文档 ID，
 * 只在处理器边界换名，不在领域内部做大面积改名：
 * - 输入：处理器用 `parseDocumentCapabilityInput` 校验后，把顶层 `documentId` 换成 `projectId` 交给服务；
 * - 输出：`withDocumentIdOutput` 包住注册器，把处理器结果顶层的 `projectId` 换成 `documentId` 再交给输出校验。
 * 嵌套字段不自动换名，由各处理器显式处理（如画布生成的 destination）。
 */

/** 校验能力输入后把顶层 `documentId` 换成领域服务使用的 `projectId`。 */
export function parseDocumentCapabilityInput<TInput>(id: string, input: unknown): TInput {
  return documentIdToProjectId(parseCapabilityInput<Record<string, unknown>>(id, input)) as TInput
}

export function documentIdToProjectId<T>(value: T): T {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !('documentId' in value)) return value
  const { documentId, ...rest } = value as Record<string, unknown>
  return { ...rest, projectId: documentId } as T
}

export function projectIdToDocumentId(value: Record<string, unknown>): Record<string, unknown> {
  if (!('projectId' in value)) return value
  const { projectId, ...rest } = value
  return { ...rest, documentId: projectId }
}

/** 包住注册器：该领域全部处理器的结果顶层 `projectId` 改叫 `documentId`。 */
export function withDocumentIdOutput(registrar: ApplicationCapabilityHandlerRegistrar): ApplicationCapabilityHandlerRegistrar {
  return {
    registerHandler(id, handler) {
      // 同步处理器保持同步（同步抛错仍同步抛出），异步的等结果再换名
      registrar.registerHandler(id, (input, context) => {
        const result = handler(input, context)
        return result instanceof Promise ? result.then(projectIdToDocumentId) : projectIdToDocumentId(result)
      })
    },
  }
}
