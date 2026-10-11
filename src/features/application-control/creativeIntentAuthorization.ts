import { z } from 'zod'
import type { ApplicationCallerGrant } from '@/core/application-control/callerContext'
import { CREATIVE_INTENT_CAPABILITIES } from '@/core/application-control/domains/creativeIntent/creativeIntentCapabilities'
import { applicationRefSchema } from '@/core/application-control/identifiers'
import { intentHost, intentRecord } from './creativeIntentHost'

/** Connection permissions and resource consent are independent, conjunctive checks. */
export function creativeIntentPrivateAccess(capabilityId: string, input: unknown): ApplicationCallerGrant['privateAccess'] {
  const capability = CREATIVE_INTENT_CAPABILITIES.find(value => value.id === capabilityId && value.dataClasses.includes('C2'))
  if (!capability) return undefined
  const parsed = z.object({ documentRef: applicationRefSchema.optional(), draftRef: applicationRefSchema.optional(), sessionId: z.string() }).parse(input)
  const host = parsed.documentRef ? intentHost(parsed.documentRef) : parsed.draftRef ? intentRecord(parsed.draftRef).host : undefined
  if (!host || host.documentRef.kind !== `${capability.domain}.document`) throw new Error('PERMISSION_DENIED:讲解必须来自目标原稿的文档。')
  const session = host.read().sessions.find(value => value.id === parsed.sessionId)
  if (!session?.consent?.textUpload) throw new Error('PERMISSION_DENIED:请先在录制宿主确认讲解文字外发。')
  const baseline = JSON.stringify(session)
  return { assertCurrent: () => {
    host.assertCurrent()
    if (JSON.stringify(host.read().sessions.find(value => value.id === parsed.sessionId)) !== baseline) {
      throw new Error('PERMISSION_DENIED:讲解或授权已变化，请重新读取授权范围。')
    }
  } }
}
