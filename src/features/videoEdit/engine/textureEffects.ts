/** 质感组的规划登记；老式画面走着色器图，没有内置工序。 */
import { HALFTONE_PLANNER } from './halftone'
import { DITHER_PATTERN_PLANNER } from './ditherPattern'
import { PAPER_PLANNER } from './paper'
import { SCRATCHES_PLANNER } from './scratches'

export const TEXTURE_EFFECT_PLANNERS = [HALFTONE_PLANNER, DITHER_PATTERN_PLANNER, PAPER_PLANNER, SCRATCHES_PLANNER] as const
