import type { TextPlanMeasure } from '../../imaging/vectorContent/textDrawPlan'
import {CODE_MATERIAL_LIMITS,CodeMaterialError,type CodeTextLayout,type CodeTextMeasureRequest} from './contract'
import {layoutCodeText as layout,TextLayoutError,type CodeTextLayoutOptions} from '../../imaging/vectorContent/codeTextLayout'
export {codeFont} from '../../imaging/vectorContent/codeTextLayout'
export function layoutCodeText(request:CodeTextMeasureRequest,measure:TextPlanMeasure,options:CodeTextLayoutOptions):CodeTextLayout {
  if(request.text.length>CODE_MATERIAL_LIMITS.textCharacters || request.fontSize>1024)throw new CodeMaterialError('BUDGET','代码文字超出执行器单次纹理预算。')
  try{return layout(request,measure,options)}catch(cause){if(cause instanceof TextLayoutError)throw new CodeMaterialError(cause.code,cause.message);throw cause}
}
