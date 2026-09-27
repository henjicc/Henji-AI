import { EventSourceParserStream } from '@ai-sdk/provider-utils'

/** MiMo 返回完整 reasoning_text；OpenAI adapter 只识别 summary 事件。
 * 只在 MiMo Responses 边界改写事件名/索引，不丢弃正文、工具或 usage。
 */
export function adaptMimoResponses(response: Response): Response {
  if (!response.ok || !response.body || !response.headers.get('content-type')?.includes('text/event-stream')) return response
  let terminal = false
  const stream = response.body
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(new EventSourceParserStream())
    .pipeThrough(new TransformStream({
      transform(event, controller) {
        if (!event.data || event.data === '[DONE]') return
        const value = JSON.parse(event.data) as Record<string, unknown>
        if (['response.completed', 'response.incomplete', 'response.failed', 'error'].includes(String(value.type))) terminal = true
        if (value.type === 'response.reasoning_text.delta') {
          value.type = 'response.reasoning_summary_text.delta'
          value.summary_index = value.content_index ?? 0
        } else if (value.type === 'response.content_part.added' || value.type === 'response.content_part.done') {
          const part = value.part as Record<string, unknown> | undefined
          if (part?.type === 'reasoning_text') {
            value.type = value.type === 'response.content_part.added'
              ? 'response.reasoning_summary_part.added' : 'response.reasoning_summary_part.done'
            value.summary_index = value.content_index ?? 0
          }
        }
        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(value)}\n\n`))
      },
      flush() {
        if (!terminal) throw new Error('[provider_response_incomplete] MiMo Responses stream ended before a terminal event')
      },
    }))
  const headers = new Headers(response.headers)
  headers.delete('content-length')
  headers.delete('content-encoding')
  return new Response(stream, { status: response.status, statusText: response.statusText, headers })
}
