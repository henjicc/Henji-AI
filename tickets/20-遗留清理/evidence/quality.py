import json, pathlib, subprocess, sys
from PIL import Image, ImageDraw

sys.stdout.reconfigure(encoding='utf-8')
root = pathlib.Path(__file__).resolve().parent
ffmpeg = next(pathlib.Path('native/video-decoder/ffmpeg').rglob('ffmpeg.exe')).resolve()
items = json.loads((root / 'cache-index.json').read_text('utf-8'))
selected = []
for target in [0, 60, 175, 342]:
    nearest = min(abs(i['startFrame']/i['fps'] - target) for i in items)
    candidates = [i for i in items if abs(i['startFrame']/i['fps'] - target) == nearest]
    item = max(candidates, key=lambda i: pathlib.Path(i['path']).stat().st_mtime)
    selected.append(item)
(root / 'selected.json').write_text(json.dumps(selected, ensure_ascii=False, indent=2), 'utf-8')

def run(args, name):
    with (root / (name + '.log')).open('w', encoding='utf-8') as log:
        subprocess.run([str(ffmpeg), '-hide_banner', '-y', *args], stdout=log, stderr=log, check=True, cwd=root)

if len(sys.argv) > 1 and sys.argv[1] == 'thumbs':
    sheet = Image.new('RGB', (960, 580), 'white')
    draw = ImageDraw.Draw(sheet)
    for n, item in enumerate(selected):
        run(['-hwaccel','cuda','-ss','1','-i',item['path'],'-frames:v','1','-vf','scale=480:270',str(root/f'thumb{n}.png')],f'thumb{n}')
        x,y = (n%2)*480,(n//2)*290
        sheet.paste(Image.open(root/f'thumb{n}.png'), (x,y+20))
        draw.text((x+5,y+2),f'{n}: {item["startFrame"]/item["fps"]:.2f}s',fill='black')
    sheet.save(root/'selection.png')
    sys.exit()

results = []
base = ['-c:v','h264_nvenc','-preset','p6','-g','120','-bf','3','-pix_fmt','yuv420p','-profile:v','high',
        '-tune','hq','-rc','vbr','-rc-lookahead','20','-spatial-aq','1','-temporal-aq','0',
        '-vf','scale=in_range=tv:in_color_matrix=bt709:out_range=tv:out_color_matrix=bt709',
        '-color_range','tv','-colorspace','bt709','-color_primaries','bt709','-color_trc','bt709']
for n, item in enumerate(selected):
    for label, quality in [('cq28',['-cq','28','-b:v','0']),('50m',['-b:v','50M'])]:
        out = root / f'{n}-{label}.mp4'
        run(['-hwaccel','cuda','-i',item['path'],'-an','-frames:v','120',*base,*quality,'-movflags','+faststart',str(out)],f'{n}-{label}-encode')
        metric = f'{n}-{label}-vmaf.json'
        run(['-hwaccel','cuda','-i',str(out),'-hwaccel','cuda','-i',item['path'],
             '-lavfi',f'[0:v]setpts=PTS-STARTPTS[d];[1:v]trim=end_frame=120,setpts=PTS-STARTPTS[r];[d][r]libvmaf=model=version=vmaf_4k_v0.6.1:log_fmt=json:log_path={metric}:n_threads=4',
             '-an','-f','null','-'],f'{n}-{label}-metric')
        data = json.loads((root/metric).read_text('utf-8'))
        result = {'segment':n,'startSeconds':item['startFrame']/60,'label':label,'bytes':out.stat().st_size,
                  'mbps':out.stat().st_size*8/2/1e6,'vmaf':data['pooled_metrics']['vmaf'], 'frames':len(data['frames']), 'source':item}
        results.append(result)
        (root/'quality-results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),'utf-8')
        print(json.dumps({k:v for k,v in result.items() if k!='source'},ensure_ascii=False),flush=True)
    cqdata=json.loads((root/f'{n}-cq28-vmaf.json').read_text('utf-8'))
    worst=min(cqdata['frames'],key=lambda f:f['metrics']['vmaf'])['frameNum']
    for label, path in [('reference',item['path']),('cq28',str(root/f'{n}-cq28.mp4')),('50m',str(root/f'{n}-50m.mp4'))]:
        run(['-hwaccel','cuda','-i',path,'-vf',f'select=eq(n\\,{worst})','-frames:v','1','-fps_mode','vfr',str(root/f'{n}-{label}-worst.png')],f'{n}-{label}-screenshot')
    print(f'segment {n} worst frame: {worst}',flush=True)
