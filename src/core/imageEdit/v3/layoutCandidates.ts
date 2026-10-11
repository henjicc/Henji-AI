import { createLayoutCandidates, solveAdaptiveLayout, solveStaticLayout, type LayoutItem, type LayoutCandidate } from '../../creativeIntent/layout'
import { refKey, type CandidateIdentity, type LayoutConstraint } from '../../creativeIntent/contracts'
import { CreativeIntentError, type ComputationControl } from '../../creativeIntent/sampling'
import { translateAffine } from '../../imaging/transforms'

/** All families consume the shared Kiwi/elimination kernel; this host only names the hero suggestion. */
export function createImageLayoutCandidates(items:readonly LayoutItem[],constraints:readonly LayoutConstraint[],identity:CandidateIdentity,fidelity:number,control:ComputationControl={}):LayoutCandidate[] {
  let candidates=createLayoutCandidates(items,constraints,identity,control)
  if(!items.some(i=>i.translationLocked)) {
    const area=(item:LayoutItem):number=>(Math.max(...item.worldCorners.map(p=>p[0]))-Math.min(...item.worldCorners.map(p=>p[0])))*(Math.max(...item.worldCorners.map(p=>p[1]))-Math.min(...item.worldCorners.map(p=>p[1])))
    const main=items.reduce((a,b)=>area(a)>area(b)?a:b)
    try {
      const solve=constraints.every(c=>c.strength==='soft')?solveAdaptiveLayout:solveStaticLayout
      const candidate=solve(items.map(i=>({...i,translationLocked:refKey(i.targetRef)===refKey(main.targetRef)})),constraints,identity,control)
      candidate.id='hero';candidate.label='保留主图，整理周围';candidates.push(candidate)
    } catch(error) {if(!(error instanceof CreativeIntentError)||error.code!=='layout-conflict')throw error}
  }
  if(fidelity>0&&!constraints.some(c=>c.strength==='hard')) candidates=candidates.map(c=>({...c,changes:c.changes.map(change=>{
    const item=items.find(i=>refKey(i.targetRef)===refKey(change.targetRef))!
    const delta:[number,number]=[change.delta[0]*(1-fidelity),change.delta[1]*(1-fidelity)]
    return {...change,delta,affine:translateAffine(item.affine,delta)}
  })}))
  const signatures=new Set<string>()
  return candidates.filter(candidate=>{const key=JSON.stringify(candidate.changes.map(c=>c.affine.map(n=>Math.round(n*1e8)/1e8)));if(signatures.has(key))return false;signatures.add(key);return true})
}
