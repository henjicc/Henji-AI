/**
 * Input limits configuration.
 */

import type { RuntimeImageConstraints, RuntimeMediaDimensionConstraints } from '@henjicc/ai-sdk'
import type { ConditionExpression, ConditionFunction } from './ConditionTypes'

type InputCondition = ConditionExpression | ConditionFunction

export interface InputCountLimit {
  min?: number
  max?: number
  exact?: number
}

export type ImageConstraints = RuntimeImageConstraints

export interface VideoConstraints extends RuntimeMediaDimensionConstraints {
  maxSizeMB?: number
  minDurationSec?: number
  maxDurationSec?: number
  /**
   * 视频本地裁剪能力。声明后，画布/对话/工具面板的视频上传项会出现"裁剪"按钮，
   * 允许用户在上传后本地切出一段不超过 maxClipSeconds 的片段替换原视频。
   */
  trim?: {
    maxClipSeconds: number
  }
}

export interface InputLimitRule {
  when?: InputCondition
  images?: InputCountLimit
  videos?: InputCountLimit
  audios?: InputCountLimit
  imageConstraints?: ImageConstraints
  videoConstraints?: VideoConstraints
}

export interface InputLimitsConfig {
  images?: InputCountLimit
  videos?: InputCountLimit
  audios?: InputCountLimit
  rules?: InputLimitRule[]
}

type InputLimitsResolver = (params: DynamicValueMap) => InputLimitsConfig

export type InputLimits = InputLimitsConfig | InputLimitsResolver
