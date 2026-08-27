import {
  createAIClient,
  type MediaReader,
  type RuntimeContext,
  type Transport,
} from '@henjicc/ai-sdk'

const live = process.argv.includes('--live')
const providerId = process.env.LLM_PROVIDER_ID?.trim() || 'deepseek'
const modelId = process.env.LLM_MODEL_ID?.trim() || 'deepseek-v4-flash'
const baseUrl = process.env.LLM_BASE_URL?.trim() || 'https://api.deepseek.com'

class SingleChatTransport implements Transport {
  private paidRequests = 0

  async fetch(url: string, init?: RequestInit): Promise<Response> {
    if ((init?.method ?? 'GET').toUpperCase() === 'POST' && new URL(url).pathname.endsWith('/chat/completions')) {
      this.paidRequests += 1
      if (this.paidRequests > 1) throw new Error('Blocked a repeated paid LLM request')
    }
    return await fetch(url, init)
  }
}

class DryRunTransport implements Transport {
  calls = 0

  async fetch(): Promise<Response> {
    this.calls += 1
    return new Response(
      'data: {"choices":[{"delta":{"content":"SDK OK"}}]}\n\ndata: [DONE]\n\n',
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
    )
  }
}

const unusedMedia: MediaReader = {
  async read() {
    throw new Error('This text-only example does not read media')
  },
}

async function main(): Promise<void> {
  const dryTransport = new DryRunTransport()
  const apiKey = live ? process.env.LLM_API_KEY?.trim() : 'dry-run-not-a-secret'
  if (!apiKey) throw new Error('Missing LLM_API_KEY')

  const runtime: RuntimeContext = {
    transport: live ? new SingleChatTransport() : dryTransport,
    credentials: {
      get: (scope, requestedProviderId) => scope === 'llm' && requestedProviderId === providerId
        ? apiKey
        : undefined,
    },
    media: unusedMedia,
  }
  const client = createAIClient({ runtime })
  const prompt = '只回复两个英文单词：SDK OK'
  let output = ''

  try {
    const outcome = await client.chat.stream({
      requestId: live ? `example-llm-${Date.now()}` : 'example-llm-dry-run',
      providerId,
      modelId,
      adapter: providerId === 'deepseek' ? 'deepseek' : 'openai',
      baseUrl,
      messages: [{ role: 'user', content: prompt }],
      capabilities: { reasoning: providerId === 'deepseek' },
      reasoning: providerId === 'deepseek'
        ? { enabled: false, effort: 'high' }
        : undefined,
      policy: { max_tokens: 16 },
    }, (event) => {
      if (event.type === 'Token') output += event.data
    })

    if (!output.trim()) {
      throw new Error('LLM completed without a text token')
    }

    const conservativeCny = ((outcome.inputChars * 3) + (outcome.outputChars * 9)) / 1_000_000
    console.log(JSON.stringify({
      mode: live ? 'live' : 'dry-run',
      networkCalls: live ? 1 : 0,
      interceptedRequests: live ? undefined : dryTransport.calls,
      providerId,
      modelId,
      output,
      elapsedMs: outcome.elapsedMs,
      conservativeCnyEstimate: Number(conservativeCny.toFixed(6)),
    }))
  } finally {
    client.dispose()
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
