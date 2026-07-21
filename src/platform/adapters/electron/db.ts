import type { DbPlatform } from '@/platform/contracts/db'

const DOMAIN = 'db'

function getNativeDb(): NonNullable<typeof window.henjiNative>['db'] {
  const native = window.henjiNative
  if (!native?.db) {
    throw new Error(`[platform:${DOMAIN}] henjiNative.db is not available`)
  }
  return native.db
}

export function createElectronDb(): DbPlatform {
  return {
    execute: async (sql, params) => {
      return await getNativeDb().execute(sql, params)
    },
    select: async (sql, params) => {
      return await getNativeDb().select(sql, params)
    },
  }
}
