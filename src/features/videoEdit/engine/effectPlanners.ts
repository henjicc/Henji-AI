import * as index from './effectPlannerIndex'
import type { EffectPlanner } from './effectPlanner'
import { VIDEO_EDIT_BUILTIN_EFFECTS_DEFINITIONS } from '@/core/videoEdit/builtinEffects'
import { registerEffects } from '@/core/videoEdit/effectRegistration'

export const VIDEO_EDIT_EFFECT_PLANNER_BY_ID = registerEffects<EffectPlanner>(index)
export const VIDEO_EDIT_EFFECT_PLANNERS: readonly EffectPlanner[] = [...VIDEO_EDIT_EFFECT_PLANNER_BY_ID.values()]
export const VIDEO_EDIT_EFFECT_PREVIEW_DEFINITIONS = VIDEO_EDIT_BUILTIN_EFFECTS_DEFINITIONS.filter(definition => definition.media !== 'audio' && VIDEO_EDIT_EFFECT_PLANNER_BY_ID.get(definition.id)?.preview !== false && VIDEO_EDIT_EFFECT_PLANNER_BY_ID.has(definition.id))
