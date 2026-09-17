import type { ApplicationResult } from '../../../../src/core/application-control/invocation'

export function toMcpResult(result: ApplicationResult) {
  return { isError: !result.ok, structuredContent: result,
    content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
}
