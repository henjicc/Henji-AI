"""改前改后每次请求 token 与缓存命中估算：用真实日志的请求序列，只替换工具定义部分（只读，不碰用户资料）。
用法：python simulate.py <改前 payloads.json> <改后 payloads.json> <日志文件...>
（payloads.json 由同目录 run.sh 生成；改前那份要在改动前的提交上跑 run.sh 得到。）

估法：
- 工具 token = 请求里工具 JSON 字节 / 3.2（同一会话 8→109 个工具时请求多出 338,521 字节、DeepSeek 输入多出 105,284 token 校准得来）。
- 真实请求工具字节 ≈ Pi 形态字节 + 13 字节/工具（9ed3b90f 加载 101 个工具实测 338,521 字节，Pi 形态 337,183 字节）。
- 非工具部分 N = 真实输入合计 - 真实工具 token，改后不变（另加系统提示词增量）。
- 改后：首轮工具 = 新的界面首轮集合；每个之后真正调用的专用工具，在它之前最近一次 load_application_tools 那一步按名加载；跨消息保留。
- 未命中：改后工具集合变化的那次请求，未命中 = 变化点之后的全部（新增工具 + 全部消息），同一步真实也换了工具集时取两者较小
  （真实值含跨会话缓存）；真实因加载整段未命中、改后没变的，只算新追加的消息；其余沿用真实未命中。
- 保守口径：真实调用里只给 domains 的加载，改后要先查一轮目录再按名加载，按“多一次请求 + 目录结果进历史”计
  （目录体积按每个工具约 42.6 个 o200k token、×1.2 换成 DeepSeek token；这一步未命中只算目录本身）。
- 价格：deepseek-flash 闲时 命中 0.02 元/百万、未命中 1 元/百万（只算输入）。结果精简（B 类）不在这里。
"""
import json, sys, collections

before = json.load(open(sys.argv[1], encoding='utf8'))
after = json.load(open(sys.argv[2], encoding='utf8'))
logs = sys.argv[3:]
BPT = 3.2
OVER = 13
HIT, MISS = 0.02, 1.0
DIR_TOKENS_PER_TOOL = 42.6 * 1.2

def bytes_of(text): return len(text.encode('utf8'))
after_tool = {t['name']: bytes_of(t['piText']) + OVER for t in after['tools']}
tools_per_domain = collections.Counter(t['domain'] for t in after['tools'] if t['domain'])
after_initial = {k.split(':', 1)[1]: bytes_of(v) + OVER * len(json.loads(v)) for k, v in after['piRealSets'].items()}
# 真实首轮还有 Pi 侧注入的 load_assistant_skill（技能目录工具），按外部目录里同一工具的体积补上
after_initial = {k: v + after_tool['load_assistant_skill'] for k, v in after_initial.items()}
after_initial_names = {k.split(':', 1)[1]: [t['name'] for t in json.loads(v)] for k, v in after['piRealSets'].items()}
sys_delta_tokens = (bytes_of(after['system']) - bytes_of(before['system'])) / BPT

runs = collections.OrderedDict()
for f in logs:
    for line in open(f, encoding='utf8', errors='replace'):
        if 'embedded_agent.turn' not in line: continue
        try: e = json.loads(line)
        except Exception: continue
        c = e.get('context', {}) or {}
        rid = c.get('requestId') or e.get('requestId')
        if not rid: continue
        r = runs.setdefault(rid, {'session': c.get('sessionId'), 'reqs': [], 'tools': []})
        ev = e.get('event', '')
        if ev.endswith('model_requested'): r['reqs'].append({'m': c.get('requestMetrics', {}), 'u': None})
        elif ev.endswith('model_completed') and r['reqs']: r['reqs'][-1]['u'] = c.get('metrics', {})
        elif ev.endswith('tool_executed'):
            t = c.get('tool', {})
            r['tools'].append((len(r['reqs']), t.get('toolName'), t.get('args') or {}))

sessions = collections.OrderedDict()
for rid, r in runs.items():
    r['reqs'] = [q for q in r['reqs'] if q['u'] and q['u'].get('input') is not None]
    if r['reqs']: sessions.setdefault(r['session'], []).append((rid, r))

surface = 'workspace.generation'  # 这些真实运行都从生成页发起（首轮 search_models）
SKIP = ('load_application_tools', 'read_assistant_context', 'load_assistant_skill')

def simulate(conservative):
    rows = []
    for sid, items in sessions.items():
        initial = set(after_initial_names[surface])
        loaded = []  # 改后按名加载过的（跨消息保留，接在末尾）
        prevN = None
        history_extra = 0.0  # 保守口径下目录结果进历史的 token
        for rid, r in items:
            load_events = sorted({idx for idx, name, _ in r['tools'] if name == 'load_application_tools'})
            directory_at = collections.defaultdict(float)
            for idx, name, args in r['tools']:
                if name == 'load_application_tools' and args.get('domains') and not args.get('names') and not args.get('task'):
                    directory_at[idx] += sum(tools_per_domain[d] for d in args['domains']) * DIR_TOKENS_PER_TOOL
            load_at = collections.defaultdict(list)
            known = set(loaded)
            for idx, name, _ in r['tools']:
                if name in SKIP or name in initial or name in known or name not in after_tool: continue
                prior = [L for L in load_events if L < idx]
                load_at[prior[-1] if prior else max(0, idx - 1)].append(name); known.add(name)
            for i, q in enumerate(r['reqs']):
                m, u = q['m'], q['u']
                prompt = u['input'] + u['cacheRead']
                N = prompt - m['toolBytes'] / BPT + sys_delta_tokens + history_extra
                t_before_load = (after_initial[surface] + sum(after_tool[n] for n in loaded)) / BPT
                if conservative and directory_at.get(i):
                    # 先查目录多出的一轮：前缀不变，只有目录结果是新内容
                    d = directory_at[i]
                    rows.append({'run': rid[:8], 'extra': True, 'before_prompt': 0, 'before_miss': 0, 'before_tools': m['toolCount'],
                                 'after_prompt': N + t_before_load + d, 'after_miss': d, 'after_tools': len(initial) + len(loaded)})
                    history_extra += d; N += d
                changed_real = i > 0 and m['toolCount'] != r['reqs'][i - 1]['m']['toolCount']
                added = load_at.get(i, [])
                loaded += added
                t_after = (after_initial[surface] + sum(after_tool[n] for n in loaded)) / BPT
                if added and changed_real:
                    miss = min(u['input'] + history_extra, N + sum(after_tool[n] for n in added) / BPT)
                elif added:
                    miss = N + sum(after_tool[n] for n in added) / BPT
                elif changed_real:
                    miss = max(0.0, N - (prevN if prevN is not None else N))
                else:
                    miss = u['input']
                prevN = N
                rows.append({'run': rid[:8], 'extra': False, 'before_tools': m['toolCount'], 'before_prompt': prompt, 'before_miss': u['input'],
                             'after_tools': len(initial) + len(loaded), 'after_prompt': N + t_after, 'after_miss': min(miss, N + t_after)})
    return rows

def cost(prompt, miss): return ((prompt - miss) * HIT + miss * MISS) / 1e6
NAMES_ERA = {'0b5ed1f8', 'b0202efd', '8dc52de0', 'f8be73f6', '597eb6a4', 'e8227143', '6fb732c7'}

def report(rows, label, per_run):
    by_run = collections.OrderedDict()
    for row in rows:
        s = by_run.setdefault(row['run'], collections.Counter())
        s['reqs'] += 0 if row['extra'] else 1; s['extra'] += 1 if row['extra'] else 0
        for k in ('before_prompt', 'before_miss', 'after_prompt', 'after_miss'): s[k] += row[k]
        s['before_tools_max'] = max(s['before_tools_max'], row['before_tools']); s['after_tools_max'] = max(s['after_tools_max'], row['after_tools'])
    print(f'== {label} ==')
    if per_run:
        print(f"{'run':<10}{'请求':>4}{'+目录':>5}{'改前工具':>8}{'改后工具':>8}{'改前输入':>11}{'改后输入':>11}{'改前未命中':>11}{'改后未命中':>11}{'改前¥':>9}{'改后¥':>9}")
        for run, s in by_run.items():
            print(f"{run:<10}{s['reqs']:>4}{s['extra']:>5}{s['before_tools_max']:>8}{s['after_tools_max']:>8}{s['before_prompt']:>11.0f}{s['after_prompt']:>11.0f}"
                  f"{s['before_miss']:>11.0f}{s['after_miss']:>11.0f}{cost(s['before_prompt'], s['before_miss']):>9.3f}{cost(s['after_prompt'], s['after_miss']):>9.3f}")
    for group, keep in (('按领域加载期', lambda run: run not in NAMES_ERA), ('按名加载期', lambda run: run in NAMES_ERA), ('合计', lambda run: True)):
        t = collections.Counter()
        for run, s in by_run.items():
            if keep(run):
                for k, v in s.items(): t[k] += v
        print(f"  {group}：{t['reqs']} 次请求（改后另多 {t['extra']} 次目录请求），每次请求平均输入 {t['before_prompt'] / t['reqs']:.0f} → {t['after_prompt'] / (t['reqs'] + t['extra']):.0f}，"
              f"输入合计 {t['before_prompt']:.0f} → {t['after_prompt']:.0f}，未命中 {t['before_miss']:.0f} → {t['after_miss']:.0f}，"
              f"命中率 {1 - t['before_miss'] / t['before_prompt']:.1%} → {1 - t['after_miss'] / t['after_prompt']:.1%}，"
              f"输入费用 ¥{cost(t['before_prompt'], t['before_miss']):.3f} → ¥{cost(t['after_prompt'], t['after_miss']):.3f}")

report(simulate(False), '乐观口径（按名直接加载）', True)
report(simulate(True), '保守口径（只给 domains 的加载先多查一轮目录）', True)
print(f"系统提示词增量 {sys_delta_tokens:.0f} token/次；改后生成页首轮工具 {after_initial[surface]} 字节，约 {after_initial[surface] / BPT:.0f} token")
