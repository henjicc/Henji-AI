import { getPlatform } from '@/platform'
import type { ApplicationHostPlatform } from '@/core/application-control/localHostContracts'

export function getApplicationHostService(): ApplicationHostPlatform { return getPlatform().applicationControl }
