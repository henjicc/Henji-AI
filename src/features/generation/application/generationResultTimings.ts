import { aiReadSavedResult } from '@/commands/aiRuntime'
import { readGenerationOutputTimings } from '@/core/media/speechTimings'

/** The durable submission receipt survives transient pending-result expiry and UI unmounts. */
export async function readGenerationResultTimings(recordId: string) {
  const receipt = await aiReadSavedResult(recordId)
  return readGenerationOutputTimings(receipt?.metadata)
}
