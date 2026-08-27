/** kie 模型展示补丁聚合。 */

import { kiePresentationPart1 } from './kie/part-1'
import { kiePresentationPart2 } from './kie/part-2'
import { kiePresentationPart3 } from './kie/part-3'
import { kiePresentationPart4 } from './kie/part-4'
import { kiePresentationPart5 } from './kie/part-5'
import { kiePresentationPart6 } from './kie/part-6'

export const kiePresentation = {
  ...kiePresentationPart1,
  ...kiePresentationPart2,
  ...kiePresentationPart3,
  ...kiePresentationPart4,
  ...kiePresentationPart5,
  ...kiePresentationPart6,
}
