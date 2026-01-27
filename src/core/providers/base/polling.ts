import type { PollingConfig, ProgressStatus } from './types'
import { ProviderError, ProviderErrorCode, createPollingTimeoutError } from './errors'
import { sleep } from './utils'

export interface PollTaskStatusOptions {
  providerName: string
  log?: (message: string, data?: unknown) => void
}

/**
 * Generic polling loop used by providers that expose async task APIs.
 */
export async function pollTaskStatus<T>(
  taskId: string,
  config: PollingConfig,
  checkStatus: (taskId: string) => Promise<ProgressStatus>,
  options: PollTaskStatusOptions
): Promise<T> {
  const { interval, maxAttempts, expectedAttempts: _expectedAttempts } = config
  const { providerName } = options
  const log = options.log ?? (() => {})

  let attempts = 0

  log('Starting polling', { taskId, config })

  while (attempts < maxAttempts) {
    attempts++

    try {
      const status = await checkStatus(taskId)

      log('Polling status', {
        taskId,
        attempt: attempts,
        status: status.status,
        progress: status.progress,
      })

      if (status.status === 'COMPLETED') {
        log('Task completed', { taskId, attempts })
        return status.result as T
      }

      if (status.status === 'FAILED') {
        throw new ProviderError(
          status.error || 'Task failed',
          providerName,
          ProviderErrorCode.TASK_FAILED,
          { taskId, status }
        )
      }

      await sleep(interval)
    } catch (error) {
      if (error instanceof ProviderError) {
        throw error
      }
      // Non-fatal errors: keep polling.
      log('Polling error, retrying', { error })
    }
  }

  throw createPollingTimeoutError(providerName, attempts, maxAttempts)
}

