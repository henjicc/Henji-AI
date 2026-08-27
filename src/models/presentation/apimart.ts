/** apimart 模型展示补丁聚合。 */

import { apimartPresentationPart1 } from './apimart/part-1'
import { apimartPresentationPart2 } from './apimart/part-2'
import { apimartPresentationPart3 } from './apimart/part-3'
import { apimartPresentationPart4 } from './apimart/part-4'
import { apimartPresentationPart5 } from './apimart/part-5'

export const apimartPresentation = {
  ...apimartPresentationPart1,
  ...apimartPresentationPart2,
  ...apimartPresentationPart3,
  ...apimartPresentationPart4,
  ...apimartPresentationPart5,
}
