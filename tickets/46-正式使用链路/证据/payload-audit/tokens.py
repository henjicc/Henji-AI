"""助手信息冗余总账：读 audit.test.ts 写出的 payloads.json，按两种估算出 token。
o200k = tiktoken o200k_base（离线参照，不是 DeepSeek 计费分词）；est = 仓库 contextBudget.estimateContextTokens 的同算法（保守，偏高）。
"""
import json, re, sys
from collections import Counter
import tiktoken

ENC = tiktoken.get_encoding('o200k_base')
def tk(s): return len(ENC.encode(s, disallowed_special=())) if s else 0
PART = re.compile(r'[a-zA-Z0-9_]+|[\t\n\v\f\r ]+|[^a-zA-Z0-9_\t\n\v\f\r ]')
def est(s):
    n = 0
    for m in PART.finditer(s or ''):
        v = m.group(0)
        if ord(v[0]) <= 0x7f and re.match(r'^[a-zA-Z0-9_\s]', v): n += -(-len(v) // 3)
        else: n += sum(2 if ord(c) > 0xffff else 1 for c in v)
    return n
def row(label, s): return f'{label:<58}{len(s):>9}{tk(s):>9}{est(s):>9}'
HDR = f'{"":<58}{"chars":>9}{"o200k":>9}{"est":>9}'

p = json.load(open(sys.argv[1], encoding='utf8'))
tools = {t['name']: t for t in p['tools']}
out = []
P = out.append

P('== 1. 工具定义 ==')
P(HDR)
allpi = ''.join(t['piText'] for t in p['tools'])
P(row(f'全部工具 Pi 形态 name+description+parameters（{len(p["tools"])} 个）', allpi))
P(row('全部工具 MCP tools/list 形态（含 outputSchema/annotations/title）', ''.join(t['mcpListText'] for t in p['tools'])))
P(row('  其中 description 合计', ''.join(t['description'] for t in p['tools'])))
P(row('  其中 inputSchema 合计', ''.join(t['inputSchemaText'] for t in p['tools'])))
P(row('  其中 outputSchema 合计（MCP 才有）', ''.join(t['outputSchemaText'] for t in p['tools'])))
P(row('  includeRevisions/Evidence/Details 三字段（每个工具都带）', ''.join(t['detailFieldsText'] for t in p['tools'])))
P(row('  "$schema" 键', ''.join(t['schemaKeyText'] for t in p['tools'])))
P(row('  operationId+baselineIds 信封（写工具）', ''.join(t['envelopeText'] for t in p['tools'])))
P(row('  $defs（zod reused:ref 抽出的定义）', ''.join(t['defsText'] for t in p['tools'])))
P(f'  带 detail 三字段的工具数 {sum(1 for t in p["tools"] if t["detailFieldsText"])}；写工具数 {sum(1 for t in p["tools"] if t["envelopeText"])}')
# ref 对象里的 label/revision
refblob = '{"additionalProperties":false,"properties":{"id":{"minLength":1,"type":"string"},"kind":{"minLength":1,"type":"string"},"label":{"maxLength":200,"minLength":1,"type":"string"},"revision":{"maximum":9007199254740991,"minimum":0,"type":"integer"}}'
P(f'  ref 对象带 label/revision 的出现次数：{allpi.count(chr(34)+"label"+chr(34)+":{"+chr(34)+"maxLength"+chr(34)+":200")}；9007199254740991 出现 {allpi.count("9007199254740991")} 次')
P('')
P('前 25 名（Pi 形态）：')
P(f'{"tool":<46}{"domain":<16}{"chars":>8}{"o200k":>8}{"desc":>7}{"schema":>8}')
for t in sorted(p['tools'], key=lambda t: -tk(t['piText']))[:25]:
    P(f'{t["name"]:<46}{str(t["domain"]):<16}{len(t["piText"]):>8}{tk(t["piText"]):>8}{tk(t["description"]):>7}{tk(t["inputSchemaText"]):>8}')
P('')
P('按领域合计（Pi 形态）：')
dom = Counter(); cnt = Counter()
for t in p['tools']: dom[str(t['domain'])] += tk(t['piText']); cnt[str(t['domain'])] += 1
for d, v in dom.most_common(): P(f'  {d:<22}{cnt[d]:>4} 个 {v:>8} tok')
P('')
P('Pi 工具集（首轮界面 / 按领域加载 / 按任务加载）：')
for k, names in p['piSets'].items():
    s = ''.join(tools[n]['piText'] for n in names if n in tools)
    P(f'  {k:<36}{len(names):>4} 个 {tk(s):>8} tok  {len(s.encode()):>8} bytes')
if 'piRealSets' in p:
    P('Pi 真实首轮（经 PiToolDisclosure，含 load_application_tools 与 read_assistant_context）：')
    for k, v in p['piRealSets'].items(): P(f'  {k:<36}{tk(v):>8} tok  {len(v.encode()):>8} bytes')
    P(row('  domains=video_edit 目录结果（一次性，进历史）', p['directoryText']))
P('')
P('重复短语（出现在 >=5 个工具说明中的 12 字以上片段，抽样）：')
descs = [t['description'] for t in p['tools']]
grams = Counter()
for d in descs:
    seen = set()
    for i in range(0, max(0, len(d) - 16)):
        g = d[i:i + 16]
        if g not in seen: seen.add(g); grams[g] += 1
shown = []
for g, c in grams.most_common(400):
    if c < 5: break
    if any(g[:8] in s for s in shown): continue
    shown.append(g); P(f'  {c:>3}× {g}')
    if len(shown) >= 15: break

P('\n通用开销精简模拟（只做机械变换，不改业务字段）：')
def slim(schema_text, inline_text):
    s = json.loads(inline_text or schema_text)
    def walk(v):
        if isinstance(v, list): return [walk(x) for x in v]
        if not isinstance(v, dict): return v
        v = {k: walk(x) for k, x in v.items() if k != '$schema'}
        props = v.get('properties')
        if isinstance(props, dict):
            for k in ('includeRevisions', 'includeEvidence', 'includeDetails'): props.pop(k, None)
            if 'kind' in props and 'id' in props: props.pop('label', None); props.pop('revision', None)
            if 'operationId' in props: props['operationId'] = {'type': 'string', 'format': 'uuid'}
            if 'baselineIds' in props: props['baselineIds'] = {'type': 'array', 'items': {'type': 'string', 'format': 'uuid'}}
        if v.get('maximum') == 9007199254740991: v.pop('maximum')
        return v
    return json.dumps(walk(s), ensure_ascii=False, separators=(',', ':'))
def slim_set(names):
    before = after = after_inline = 0
    for n in names:
        t = tools.get(n)
        if not t: continue
        before += tk(t['piText'])
        after_inline += tk(json.dumps({'name': n, 'description': t['description']}, ensure_ascii=False) + (t['inlineSchemaText'] + t['envelopeText'] + t['detailFieldsText'] if t['inlineSchemaText'] else t['inputSchemaText']))
        after += tk(json.dumps({'name': n, 'description': t['description']}, ensure_ascii=False) + slim(t['inputSchemaText'], ''))
    return before, after_inline, after
for k in ['initial:workspace.generation', 'initial:workspace.video_edit', 'domain:video_edit', 'domain:camera_stage', 'domain:image_edit', 'domain:screen_recording']:
    b, i, a = slim_set(p['piSets'][k])
    P(f'  {k:<34} 现状 {b:>7}  改内联 {i:>7}  保留$ref+去通用字段 {a:>7}  省 {100*(b-a)/b:5.1f}%')
b, i, a = slim_set([t['name'] for t in p['tools']])
P(f'  {"全部工具":<34} 现状 {b:>7}  改内联 {i:>7}  保留$ref+去通用字段 {a:>7}  省 {100*(b-a)/b:5.1f}%')

P('\n== 2. 契约 ==')
P(HDR)
for k, v in p['contract'].items(): P(row(f'describe_application_contract {k}', v))

P('\n== 3. describe_application_entities（经结果投影后） ==')
P(f'{"domain":<16}{"ent":>5}{"prop":>6}{"page1 tok":>11}{"compactAll":>12}{"fullAll":>10}')
for d, v in p['describe'].items():
    if 'error' in v: P(f'{d:<16} error {v["error"][:80]}'); continue
    P(f'{d:<16}{v["entities"]:>5}{v["properties"]:>6}{tk(v["compactPage1"]):>11}{tk(v["compactAll"]):>12}{tk(v["fullAll"]):>10}')
P('单实体：')
for k, v in p['entitySamples'].items(): P(row(f'  {k}', v))

P('\n== 4. 模型 ==')
P(HDR)
for k, v in p['models'].items():
    P(f'{k}: 共 {v["total"]} 个模型（首页 32）')
    P(row('  raw', v['raw'])); P(row('  projected（真实通道）', v['projected'])); P(row('  单个模型条目', v['oneModelProjected'])); P(row('  selectionEvidence（每条重复）', v['selectionEvidence']))
sch = sorted(p['schemas'], key=lambda s: -tk(s['projected']))
vals = [tk(s['projected']) for s in sch]
P(f'get_model_schema：{len(sch)} 个模型，projected 中位 {sorted(vals)[len(vals)//2]} tok，最大 {vals[0]}，最小 {vals[-1]}，raw/projected 合计 {sum(tk(s["raw"]) for s in sch)}/{sum(vals)}')
for s in sch[:8]: P(f'  {s["id"]:<48}{s["type"]:<7}{tk(s["projected"]):>7} tok')

P('prepare_generation_task 领域输出（300 字提示词）：')
for k, v in p['prepared'].items(): P(row(f'  {k}', v))
P('\n== 5. 系统提示词与技能 ==')
P(HDR)
P(row('SYSTEM_INSTRUCTIONS（含 MEMORY_RULES/PROJECT_PROGRESS_RULES）', p['system']))
P(row('  MEMORY_RULES', p['memoryRules'])); P(row('  PROJECT_PROGRESS_RULES', p['progressRules']))
P(row('skills_index（9 个技能元数据，进系统提示词）', p['skillsIndexText']))
for k, v in p['piSurfaceGuidance'].items(): P(row(f'  界面引导 {k}', v))
P('技能文档（按需加载，单份体积）：')
for f in sorted(p['skillFiles'], key=lambda f: -tk(f['text']))[:20]: P(f'  {f["path"]:<90}{tk(f["text"]):>7} tok')
P(f'  技能 .md 共 {len(p["skillFiles"])} 份，合计 {sum(tk(f["text"]) for f in p["skillFiles"])} tok；SKILL.md 主文件合计 {sum(tk(f["text"]) for f in p["skillFiles"] if f["path"].endswith("SKILL.md"))} tok')
print('\n'.join(out))
