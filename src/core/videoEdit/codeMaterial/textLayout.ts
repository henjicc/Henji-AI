import {CodeMaterialError,type CodeTextLayout,type CodeTextMeasureRequest} from './contract'
import {layoutCodeText as layout,TextLayoutError} from '../../imaging/vectorContent/codeTextLayout'
export {codeFont} from '../../imaging/vectorContent/codeTextLayout'
export function layoutCodeText(request:CodeTextMeasureRequest,advance:(text:string,font:string)=>number,missingFont?:string):CodeTextLayout {
  if(request.text.length>4096 || request.fontSize>1024)throw new CodeMaterialError('BUDGET','代码文字超出执行器单次纹理预算。')
  try{return layout(request,advance,missingFont)}catch(cause){if(cause instanceof TextLayoutError)throw new CodeMaterialError(cause.code,cause.message);throw cause}
}
