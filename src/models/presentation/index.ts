import type { ModelPresentation } from '@/core/types/ModelPresentation'

import { apimartPresentation } from './apimart'
import { bailianPresentation } from './bailian'
import { falPresentation } from './fal'
import { grsaiPresentation } from './grsai'
import { kiePresentation } from './kie'
import { modelscopePresentation } from './modelscope'
import { ppioPresentation } from './ppio'
import { volcenginePresentation } from './volcengine'
import { gptImage25Presentation } from './gpt-image-2.5'

export const modelPresentations: Readonly<Record<string, ModelPresentation>> = {
  ...gptImage25Presentation,
  ...apimartPresentation,
  ...bailianPresentation,
  ...falPresentation,
  ...grsaiPresentation,
  ...kiePresentation,
  ...modelscopePresentation,
  ...ppioPresentation,
  ...volcenginePresentation,
}
