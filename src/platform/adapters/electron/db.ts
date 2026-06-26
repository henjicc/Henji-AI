import { PlatformNotImplementedError } from '@/platform/types'
import type { DbPlatform } from '@/platform/contracts/db'

const DOMAIN = 'db'

export function createElectronDb(): DbPlatform {
  return {
    execute: () => {
      throw new PlatformNotImplementedError(DOMAIN, 'execute')
    },
    select: () => {
      throw new PlatformNotImplementedError(DOMAIN, 'select')
    },
  }
}
