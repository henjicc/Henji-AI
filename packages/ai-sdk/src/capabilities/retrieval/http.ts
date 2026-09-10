import { fetchProvider } from '../../providers/provider-fetch'
import { AiRuntimeError } from '../../runtime/AiRuntimeError'
import type { CapabilityExecutionContext } from '../types'
import { invalidInput, invalidResponse, record } from './validation'

export function apiRoot(value: string | undefined): string {
  if (typeof value !== 'string' || !value.trim()) invalidInput('A region/workspace API baseUrl is required')
  let parsed: URL
  try { parsed = new URL(value) } catch { return invalidInput('Invalid API baseUrl') }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash || /[{}]/.test(value)) {
    invalidInput('API baseUrl must be HTTP(S), without credentials, placeholders, query or fragment')
  }
  return value.trim().replace(/\/+$/, '')
}

export async function requestJson(
  context: CapabilityExecutionContext,
  providerId: string,
  credentialId: string,
  kind: 'embedding' | 'rerank',
  endpoint: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  context.signal.throwIfAborted()
  const key = await context.runtime.credentials.get(kind, credentialId)
  if (!key?.trim()) throw new AiRuntimeError('api_key_missing', `${providerId} ${kind} API key is not configured`)
  context.signal.throwIfAborted()
  const response = await fetchProvider(`${providerId} ${kind}`, endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key.trim()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: context.signal,
  }, { transport: context.runtime.transport, retryPreconnectOnce: false })
  // Read even error responses to release the underlying response body. Never log body content.
  const responseText = await response.text()
  context.signal.throwIfAborted()
  if (!response.ok) throw new AiRuntimeError('provider_error', `${providerId} ${kind} failed with HTTP ${response.status}`)
  let decoded: unknown
  try { decoded = JSON.parse(responseText) } catch { return invalidResponse('Provider returned invalid JSON') }
  const raw = record(decoded, 'response')
  if (raw.error || (raw.code !== undefined && raw.code !== null && raw.code !== '' && raw.code !== 0)) {
    throw new AiRuntimeError('provider_error', `${providerId} ${kind} returned a provider error`)
  }
  return raw
}
