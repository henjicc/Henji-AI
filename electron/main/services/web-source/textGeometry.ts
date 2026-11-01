import { WEB_TEXT_SAMPLER_VERSION, type WebTextResults } from '../../../../src/core/videoEdit/webTextGeometry'

export class WebTextCaptureError extends Error {
  constructor(readonly code: 'font-timeout' | 'prepare-failed' | 'sampling-failed', message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'WebTextCaptureError'
  }
}

/** 只在声明文本的请求里执行；观察器跟随页面销毁，不跨帧复用布局。 */
export const TEXT_GEOMETRY_PREPARE_SCRIPT = `(async () => {
  let state = window.__henjiWebText
  if (!state) {
    state = { generation: 0, fontsFailed: false }
    state.observer = new MutationObserver(records => { if (records.length) state.generation++ })
    state.observer.observe(document.documentElement, { subtree:true, childList:true, attributes:true, characterData:true })
    document.fonts?.addEventListener('loading', () => state.generation++)
    document.fonts?.addEventListener('loadingerror', () => { state.generation++; state.fontsFailed = true })
    window.__henjiWebText = state
  }
  document.documentElement.getBoundingClientRect()
  if (document.fonts) await document.fonts.ready
  state.fontsFailed = !!document.fonts && [...document.fonts].some(font => font.status === 'error')
  if (state.observer.takeRecords().length) state.generation++
})()`

/** 浏览器原生排版与 Unicode 分段；不包 span，不重排文字。函数体直接在隔离世界执行。 */
const SAMPLER = String.raw`(selectors, stage, region, trace) => {
  const started = performance.now()
  const results = Object.create(null), nodeCache = new Map(), styles = new Map(), visibility = new Map(), targetCache = new Map(), segmenters = new Map()
  const range = document.createRange()
  const rect = r => [r.x, r.y, r.width, r.height]
  const styleOf = element => {
    let value = styles.get(element)
    if (!value) { value = getComputedStyle(element); styles.set(element, value) }
    return value
  }
  const visibilityOf = element => {
    if (visibility.has(element)) return visibility.get(element)
    const own = styleOf(element)
    let hidden = own.visibility === 'hidden' || own.visibility === 'collapse' ? 'visibility-hidden' : null, opacity = 1
    for (let at = element; at; at = at.parentElement) {
      const s = styleOf(at)
      if (s.display === 'none') hidden = 'display-none'
      else if (s.contentVisibility === 'hidden' && !hidden) hidden = 'content-hidden'
      opacity *= Number(s.opacity)
      if (at === stage) break
    }
    const value = { hidden, transparent: opacity === 0 }
    visibility.set(element,value)
    return value
  }
  const measureNode = node => {
    let value = nodeCache.get(node)
    if (!value) {
      range.selectNodeContents(node)
      const visibility = visibilityOf(node.parentElement), rendered = !visibility.hidden
      // 一次读取整个 Text 节点的全部行盒；字素仍取原生子区间，不能按行宽均分或猜测连字宽度。
      value = { visibility, lines: rendered ? [...range.getClientRects()].filter(r => r.width >= 0 && r.height > 0).map(rect) : [], rendered, parts:new Map() }
      nodeCache.set(node, value)
    }
    return value
  }
  for (const selector of selectors) {
    let target
    try { target = document.querySelector(selector) } catch { throw new Error('无效文本 CSS 选择器：' + selector) }
    if (!target) { results[selector] = { status:'not-found' }; continue }
    if (!stage.contains(target)) { results[selector] = { status:'unsupported', reason:'outside-stage' }; continue }
    if (target.namespaceURI !== 'http://www.w3.org/1999/xhtml' || /^(CANVAS|INPUT|TEXTAREA|SELECT|IFRAME)$/.test(target.tagName)) {
      results[selector] = { status:'unsupported', reason:'non-dom-text' }; continue
    }
    if (targetCache.has(target)) { results[selector] = targetCache.get(target); continue }
    const fonts = [], fontIds = new Map(), nodes = [], breaks = new Map(), limitations = new Set()
    let text = '', flow = 0
    const fontOf = element => {
      if (fontIds.has(element)) return fontIds.get(element)
      const style = styleOf(element), font = {}
      for (const key of ['fontFamily','fontSize','fontWeight','fontStyle','fontStretch','lineHeight','letterSpacing','wordSpacing','direction','writingMode','fontFeatureSettings','fontVariationSettings','whiteSpace','textTransform']) font[key] = style[key]
      font.lang = element.closest('[lang]')?.getAttribute('lang') || 'zh-CN'
      const id = fonts.length; fonts.push(font); fontIds.set(element,id); return id
    }
    const boundary = kind => { breaks.set(text.length+':'+kind,{offset:text.length,kind}); flow++ }
    const pending = [{element:target,exit:false}]
    while (pending.length) {
      const {element,exit} = pending.pop()
      if (exit) { boundary('block'); continue }
      if (element.nodeType === Node.TEXT_NODE) {
        if (!element.data.length) continue
        const font = fontOf(element.parentElement), lang = fonts[font].lang
        if (nodes.length && nodes[nodes.length-1].lang !== lang) boundary('language')
        nodes.push({ node:element, start:text.length, end:text.length+element.data.length, font, flow, lang })
        text += element.data
        continue
      }
      if (element.nodeType !== Node.ELEMENT_NODE || /^(SCRIPT|STYLE|TEMPLATE|NOSCRIPT)$/.test(element.tagName)) continue
      if (element !== target && (element.namespaceURI !== 'http://www.w3.org/1999/xhtml' || /^(CANVAS|INPUT|TEXTAREA|SELECT|IFRAME|IMG|VIDEO|AUDIO|OBJECT|EMBED)$/.test(element.tagName))) {
        limitations.add('non-dom-text'); boundary('replaced-element'); continue
      }
      if (element.tagName === 'BR') { boundary('line-break'); continue }
      const block = element !== target && !['inline','contents','none'].includes(styleOf(element).display)
      if (block) boundary('block')
      for (const pseudo of ['::before','::after','::marker']) {
        const content = getComputedStyle(element,pseudo).content
        if (content && content !== 'none' && content !== 'normal' && content !== '""') limitations.add('generated-content')
      }
      if (element.shadowRoot) limitations.add('shadow-dom')
      if (block) pending.push({element,exit:true})
      for (let child=element.lastChild;child;child=child.previousSibling) pending.push({element:child,exit:false})
    }
    const lineFragments = [], nodeLines = []
    nodes.forEach((entry,node) => {
      nodeLines[node] = measureNode(entry.node).lines.map(r => {
        const index = lineFragments.length; lineFragments.push({rect:r,node,font:entry.font}); return index
      })
    })
    const graphemes = [], words = [], segmentation = []
    const flows = []
    nodes.forEach((entry,index) => {
      const last = flows[flows.length-1]
      if (last && last.flow === entry.flow) { last.end = entry.end; last.nodes.push(index) }
      else flows.push({ flow:entry.flow, start:entry.start, end:entry.end, nodes:[index], lang:entry.lang })
    })
    for (const f of flows) {
      let pair = segmenters.get(f.lang)
      if (!pair) {
        try { pair = [new Intl.Segmenter(f.lang,{granularity:'grapheme'}),new Intl.Segmenter(f.lang,{granularity:'word'})] }
        catch { pair = [new Intl.Segmenter('zh-CN',{granularity:'grapheme'}),new Intl.Segmenter('zh-CN',{granularity:'word'})] }
        segmenters.set(f.lang,pair)
      }
      const [gs,ws] = pair
      segmentation.push({source:{start:f.start,end:f.end},locale:gs.resolvedOptions().locale,contract:'intl-segmenter'})
      const raw = text.slice(f.start,f.end), first = graphemes.length
      let cursor = 0
      for (const segment of gs.segment(raw)) {
        const start = f.start+segment.index, end = start+segment.segment.length, segments = [], rects = []
        let anyOpaque = false, visibleInRegion = false
        while (cursor < f.nodes.length && nodes[f.nodes[cursor]].end <= start) cursor++
        for (let j=cursor;j<f.nodes.length && nodes[f.nodes[j]].start<end;j++) {
          const node = f.nodes[j], entry=nodes[node], a=Math.max(start,entry.start)-entry.start, b=Math.min(end,entry.end)-entry.start
          segments.push({node,start:a,end:b,font:entry.font})
          const measured = measureNode(entry.node), key=a+':'+b
          let parts = measured.parts.get(key)
          if (!parts) {
            if (measured.rendered) {
              range.setStart(entry.node,a);range.setEnd(entry.node,b)
              parts = [...range.getClientRects()].filter(r=>r.width>=0 && r.height>0).map(rect)
            } else parts = []
            measured.parts.set(key,parts)
          }
          for (const r of parts) {
            if (!measured.visibility.transparent) {
              anyOpaque = true
              if(r[2]>0 && Math.min(r[0]+r[2],region[0]+region[2])>Math.max(r[0],region[0]) && Math.min(r[1]+r[3],region[1]+region[3])>Math.max(r[1],region[1])) visibleInRegion = true
            }
            const lines = nodeLines[node].filter(index => {
              const l=lineFragments[index].rect
              return r[0]>=l[0]-.01 && r[1]>=l[1]-.01 && r[0]+r[2]<=l[0]+l[2]+.01 && r[1]+r[3]<=l[1]+l[3]+.01
            })
            rects.push({rect:r,line:lines.length===1?lines[0]:null})
          }
        }
        let bounds=null
        if(rects.length) {
          let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity
          for(const {rect:r} of rects) {left=Math.min(left,r[0]);top=Math.min(top,r[1]);right=Math.max(right,r[0]+r[2]);bottom=Math.max(bottom,r[1]+r[3])}
          bounds=[left,top,right-left,bottom-top]
        }
        const measured = segments.map(part=>measureNode(nodes[part.node].node)), hidden = measured.every(value=>!!value.visibility.hidden)
        const rawText = text.slice(start,end), whitespace = /^[\t\n\f\r ]+$/u.test(rawText) && segments.every(part=>{const whiteSpace=styleOf(nodes[part.node].node.parentElement).whiteSpace;return ['normal','nowrap','pre-line',''].includes(whiteSpace) && (whiteSpace!=='pre-line' || !/[\r\n]/.test(rawText))}), hasWidth = rects.some(part=>part.rect[2]>0)
        const layoutStatus = hidden ? measured[0].visibility.hidden : hasWidth ? 'box' : whitespace ? 'collapsed-whitespace' : 'zero-width'
        const regionRects = rects.flatMap(part=>{
          const r=part.rect, left=Math.max(r[0],region[0]), top=Math.max(r[1],region[1]), right=Math.min(r[0]+r[2],region[0]+region[2]), bottom=Math.min(r[1]+r[3],region[1]+region[3])
          return right>=left && bottom>top && (r[2]===0 || right>left) ? [{rect:[left,top,right-left,bottom-top],line:part.line}] : []
        })
        const transparent = rects.length>0 && !anyOpaque
        graphemes.push({source:{start,end},segments,rects,bounds,pivot:bounds?[bounds[0]+bounds[2]/2,bounds[1]+bounds[3]/2]:null,baseline:null,layoutStatus,transparent,outsideRegion:rects.length>0 && regionRects.length===0,regionRects,rendered:visibleInRegion,overlaps:false})
      }
      let g = first
      for (const segment of ws.segment(raw)) {
        const start=f.start+segment.index,end=start+segment.segment.length,members=[],merged=[]
        while(g<graphemes.length && graphemes[g].source.end<=start) g++
        for(let j=g;j<graphemes.length && graphemes[j].source.start<end;j++) {
          members.push(j)
          for(const part of graphemes[j].rects) {
            const r=part.rect, prior=merged.find(p=>p.line!==null && p.line===part.line && p.rect[1]===r[1] && p.rect[3]===r[3] && r[0]<=p.rect[0]+p.rect[2]+.01 && r[0]+r[2]>=p.rect[0]-.01)
            if(prior) {const right=Math.max(prior.rect[0]+prior.rect[2],r[0]+r[2]);prior.rect[0]=Math.min(prior.rect[0],r[0]);prior.rect[2]=right-prior.rect[0]}
            else merged.push({rect:[...r],line:part.line})
          }
        }
        words.push({source:{start,end},isWordLike:!!segment.isWordLike,graphemes:members,rects:merged})
      }
    }
    // 扫描实际片段；共享连字盒与二维相交只报告事实，不推断可独立提字。
    const sorted = graphemes.flatMap((g,index)=>g.rects.map(p=>({r:p.rect,index}))).sort((a,b)=>a.r[0]-b.r[0])
    let active=[]
    for(const item of sorted) {
      active=active.filter(p=>p.r[0]+p.r[2]>item.r[0]+1/64)
      for(const other of active) if(other.index!==item.index && Math.min(other.r[1]+other.r[3],item.r[1]+item.r[3])-Math.max(other.r[1],item.r[1])>1/64) {graphemes[other.index].overlaps=true;graphemes[item.index].overlaps=true}
      active.push(item)
    }
    const result={status:'ready',geometry:{coordinateSpace:'viewport-css',coverage:'dom-text-only',text,breaks:[...breaks.values()].sort((a,b)=>a.offset-b.offset || a.kind.localeCompare(b.kind)),fonts,graphemes,words,lineFragments,segmentation,limitations:[...limitations]}}
    targetCache.set(target,result);results[selector]=result
  }
  const sampleMs=performance.now()-started
  let bytes=0, serializationMs=0
  if(trace) {const at=performance.now(); bytes=new TextEncoder().encode(JSON.stringify(results)).byteLength; serializationMs=performance.now()-at}
  return {samplerVersion:${WEB_TEXT_SAMPLER_VERSION},results,sampleMs,serializationMs,bytes}
}`

export function textGeometryPaintSetup(selectors: readonly string[], region: readonly number[], trace = false): string {
  return `const textSelectors = ${JSON.stringify(selectors)}
    const textState = window.__henjiWebText
    if (textState.observer.takeRecords().length) textState.generation++
    const textGeneration = textState.generation
    const textScroll = [window.scrollX, window.scrollY]
    const textTargets = textSelectors.flatMap(selector=>{let target;try {target=document.querySelector(selector)} catch {return []}return target && stage.contains(target)?[target]:[]})
    const textNodes = new Set()
    for(const target of textTargets) {
      textNodes.add(target)
      for(const element of target.querySelectorAll('*')) textNodes.add(element)
      for(let element=target.parentElement;element;element=element.parentElement) {textNodes.add(element);if(element===container) break}
    }
    const textScrollNodes = [...textNodes].map(element=>[element,element.scrollLeft,element.scrollTop])
    const textStageRect = stage.getBoundingClientRect()
    const unavailableText = (reason,details) => ({ samplerVersion:${WEB_TEXT_SAMPLER_VERSION}, results:Object.fromEntries(textSelectors.map(s=>[s,{status:'unavailable',reason,details}])), sampleMs:0, serializationMs:0, bytes:0 })
    const textSyncReasons = () => {
      if (textState.observer.takeRecords().length) textState.generation++
      const rootStyle = getComputedStyle(stage), rootRect = stage.getBoundingClientRect(), reasons=[]
      if(textState.generation !== textGeneration) reasons.push('dom-changed')
      if(window.scrollX !== textScroll[0] || window.scrollY !== textScroll[1]) reasons.push('window-scroll')
      if(!textScrollNodes.every(([e,x,y])=>e.scrollLeft===x && e.scrollTop===y)) reasons.push('subtree-scroll')
      if(document.fonts?.status === 'loading') reasons.push('font-loading')
      if(textState.fontsFailed || document.fonts && [...document.fonts].some(f=>f.status==='error')) reasons.push('font-error')
      if(stage.parentNode !== container) reasons.push('stage-changed')
      if([...textNodes].some(e=>e.getAnimations().some(a=>a.playState==='running'))) reasons.push('running-animation')
      if(rootStyle.transform !== 'none' || !['paddingTop','paddingRight','paddingBottom','paddingLeft','borderTopWidth','borderRightWidth','borderBottomWidth','borderLeftWidth'].every(k=>parseFloat(rootStyle[k])===0) || Math.abs(rootRect.x)>=1/64 || Math.abs(rootRect.y)>=1/64 || rootRect.width!==textStageRect.width || rootRect.height!==textStageRect.height) reasons.push('stage-geometry')
      return reasons
    }
    const sampleText = () => (${SAMPLER})(textSelectors, stage, ${JSON.stringify(region)}, ${trace})`
}

/** IPC 返回必须包含每个请求的显式状态，缺失不能补成 not-found。 */
export function validateWebTextResults(input: unknown, selectors: readonly string[]): WebTextResults {
  if (!input || typeof input !== 'object') throw new Error('网页文本几何响应不是对象')
  const values = input as Record<string, unknown>
  for (const selector of selectors) {
    const value = values[selector] as { status?: unknown; geometry?: unknown; reason?: unknown } | undefined
    if (!value || !['ready', 'not-found', 'unsupported', 'unavailable'].includes(String(value.status)) || value.status === 'ready' && (!value.geometry || typeof value.geometry !== 'object') || ['unsupported', 'unavailable'].includes(String(value.status)) && typeof value.reason !== 'string') throw new Error(`网页文本几何缺少可靠结果：${selector}`)
  }
  return values as WebTextResults
}
