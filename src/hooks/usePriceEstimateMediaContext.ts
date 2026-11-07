import { useEffect, useState } from 'react'
import type { RuntimePricingMediaContextRequirement } from '@henjicc/ai-sdk'

import { readCachedVideoDurationSeconds, resolvePriceEstimateMediaContext } from '@/core/pricing/resolvePriceEstimateMediaContext'
import { attachVideoDurations, resolveGenerationVideoSources } from '@/core/services/generationVideoDurations'

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

/** 生成面板自带上传时读到的视频时长；画布节点等其他入口没有，要在这里补读，否则按视频时长计价的模型会按兜底时长估。 */
function needsVideoDurations(params: DynamicValueMap): boolean {
  return resolveGenerationVideoSources(params).length > 0 && !Array.isArray(params.__videoDurationSeconds)
}

export function usePriceEstimateMediaContext(
  requirements: RuntimePricingMediaContextRequirement[] | undefined,
  params: DynamicValueMap,
): UsePriceEstimateMediaContextResult {
  const requiresMediaContext = Boolean(requirements?.length) || needsVideoDurations(params)
  const [state, setState] = useState<ResolvedPriceEstimateState>(() => ({
    inputParams: params,
    requirements,
    params,
    ready: !requiresMediaContext,
  }))

  useEffect(() => {
    if (!requiresMediaContext) return
    let active = true
    void attachVideoDurations(params, readCachedVideoDurationSeconds)
      .then((withDurations) => resolvePriceEstimateMediaContext(requirements, withDurations))
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
