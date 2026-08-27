/** fal 模型展示补丁聚合。 */

import { falPresentationPart1 } from './fal/part-1'
import { falPresentationPart2 } from './fal/part-2'
import { falPresentationPart3 } from './fal/part-3'
import { falPresentationPart4 } from './fal/part-4'
import { falPresentationPart5 } from './fal/part-5'
import { falPresentationPart6 } from './fal/part-6'
import { falPresentationPart7 } from './fal/part-7'

export const falPresentation = {
  ...falPresentationPart1,
  ...falPresentationPart2,
  ...falPresentationPart3,
  ...falPresentationPart4,
  ...falPresentationPart5,
  ...falPresentationPart6,
  ...falPresentationPart7,
}
