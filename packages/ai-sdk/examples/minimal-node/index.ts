import { readFile } from 'node:fs/promises'
import { basename, extname } from 'node:path'

import {
  createAIClient,
  type Logger,
  type MediaReader,
  type RuntimeContext,
  type Transport,
} from '@henjicc/ai-sdk'

const MODEL_ID = 'kie-z-image'
const CREATE_TASK_PATH = '/api/v1/jobs/createTask'
const live = process.argv.includes('--live')

class SingleCreateTransport implements Transport {
  private createRequests = 0

  async fetch(url: string, init?: RequestInit): Promise<Response> {
    const method = (init?.method ?? 'GET').toUpperCase()
    if (method === 'POST' && new URL(url).pathname === CREATE_TASK_PATH) {
      this.createRequests += 1
      if (this.createRequests > 1) {
        throw new Error('Blocked a repeated paid KIE create request')
      }
    }
    return await fetch(url, init)
  }
}

class DryRunTransport implements Transport {
  calls = 0

  async fetch(url: string, init?: RequestInit): Promise<Response> {
    this.calls += 1
    const method = (init?.method ?? 'GET').toUpperCase()
    if (method !== 'POST' || new URL(url).pathname !== CREATE_TASK_PATH) {
      throw new Error(`Dry-run rejected unexpected request: ${method} ${url}`)
    }
    return Response.json({ code: 200, data: { taskId: 'dry-run-task' } })
  }
}

const media: MediaReader = {
  async read(ref) {
    const bytes = new Uint8Array(await readFile(ref))
    return {
      bytes,
      filename: basename(ref),
      mimeType: mimeFromExtension(extname(ref)),
    }
  },
}

const logger: Logger = {
  info: (message) => console.log(`[sdk] ${message}`),
  warn: (message) => console.warn(`[sdk] ${message}`),
  error: (message) => console.error(`[sdk] ${message}`),
}

async function main(): Promise<void> {
  const dryTransport = new DryRunTransport()
  const apiKey = live ? process.env.KIE_API_KEY?.trim() : 'dry-run-not-a-secret'
  if (!apiKey) throw new Error('Missing KIE_API_KEY')

  const runtime: RuntimeContext = {
    transport: live ? new SingleCreateTransport() : dryTransport,
    credentials: {
      get: (scope, providerId) => scope === 'generation' && providerId === 'kie'
        ? apiKey
        : undefined,
    },
    media,
    logger,
  }
  const client = createAIClient({ runtime })
  const params = {
    prompt: 'A tiny blue paper boat on a calm white background, studio light',
    kieZImageAspectRatio: '1:1',
  }

  try {
    const price = client.catalog.estimatePrice(MODEL_ID, params)
    const result = await client.generate({
      modelId: MODEL_ID,
      requestId: live ? `example-kie-${Date.now()}` : 'example-kie-dry-run',
      params,
    }, {
      onRequestBuilt: ({ providerId, route, method }) => {
        console.log(JSON.stringify({ stage: 'request-built', providerId, route, method }))
      },
    })

    if (!live) {
      console.log(JSON.stringify({
        mode: 'dry-run',
        networkCalls: 0,
        interceptedRequests: dryTransport.calls,
        status: result.status,
        taskId: result.taskId,
        estimatedUsd: price,
      }))
      return
    }

    const completed = result.status === 'pending' && result.taskId
      ? await client.continuePolling({ modelId: MODEL_ID, taskId: result.taskId, params })
      : result
    if (completed.status !== 'completed' || !completed.url) {
      throw new Error(`KIE generation did not complete: ${completed.status}`)
    }
    console.log(JSON.stringify({
      mode: 'live',
      status: completed.status,
      resultUrl: completed.url,
      estimatedUsd: price,
    }))
  } finally {
    client.dispose()
  }
}

function mimeFromExtension(extension: string): string {
  const normalized = extension.toLowerCase()
  if (normalized === '.png') return 'image/png'
  if (normalized === '.webp') return 'image/webp'
  if (normalized === '.gif') return 'image/gif'
  if (normalized === '.mp4') return 'video/mp4'
  if (normalized === '.mp3') return 'audio/mpeg'
  return 'image/jpeg'
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
