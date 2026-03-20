import { createLogger } from '@/core/logging'

const logger = createLogger('hooks.useDatabase')
/**
 * Database Initialization Hook
 *
 * Initializes database connection on component mount
 */

import { useEffect, useState } from 'react'
import { databaseService } from '@/services/database/DatabaseService'

export function useDatabase() {
  const [isReady, setIsReady] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    databaseService
      .init()
      .then(() => {
        setIsReady(true)
        logger.info('[useDatabase] Database initialized successfully')
      })
      .catch((err) => {
        setError(err)
        logger.error('[useDatabase] Database initialization failed:', err)
      })
  }, [])

  return { isReady, error }
}

