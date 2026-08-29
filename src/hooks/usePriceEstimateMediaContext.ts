import { useEffect, useState } from 'react'
import type { RuntimePricingMediaContextRequirement } from '@henjicc/ai-sdk'

import { resolvePriceEstimateMediaContext } from '@/core/pricing/resolvePriceEstimateMediaContext'

interface ResolvedPriceEstimateState {
  inputParams: DynamicValueMap
  requirements: RuntimePricingMediaContextRequirement[] | undefined
  params: DynamicValueMap
  ready: boolean
}

export interface UsePriceEstimateMediaContextResult {
  params: DynamicValueMap
  ready: boolean
}

export function usePriceEstimateMediaContext(
  requirements: RuntimePricingMediaContextRequirement[] | undefined,
  params: DynamicValueMap,
): UsePriceEstimateMediaContextResult {
  const requiresMediaContext = Boolean(requirements?.length)
  const [state, setState] = useState<ResolvedPriceEstimateState>(() => ({
    inputParams: params,
    requirements,
    params,
    ready: !requiresMediaContext,
  }))

  useEffect(() => {
    if (!requiresMediaContext) return
    let active = true
    void resolvePriceEstimateMediaContext(requirements, params)
      .then((resolved) => {
        if (!active) return
        setState({
          inputParams: params,
          requirements,
          params: resolved.params,
          ready: resolved.complete,
        })
      })
      .catch(() => {
        if (!active) return
        setState({ inputParams: params, requirements, params, ready: false })
      })
    return () => {
      active = false
    }
  }, [params, requirements, requiresMediaContext])

  if (!requiresMediaContext) return { params, ready: true }
  if (state.inputParams !== params || state.requirements !== requirements) {
    return { params, ready: false }
  }
  return { params: state.params, ready: state.ready }
}
