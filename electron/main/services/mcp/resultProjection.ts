import type { ApplicationResult } from '../../../../src/core/application-control/invocation'

export function toMcpResult(result: ApplicationResult) {
  const media = result.data
  if (result.ok && media?.mode === 'image' && typeof media.base64 === 'string' && media.mimeType === 'image/jpeg') {
    const { base64, ...metadata } = media
    const summary = { ...result, data: metadata }
    return { isError: false, structuredContent: summary, content: [
      { type: 'text' as const, text: JSON.stringify(summary) },
      { type: 'image' as const, data: base64, mimeType: media.mimeType },
    ] }
  }
  return { isError: !result.ok, structuredContent: result,
    content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
}
