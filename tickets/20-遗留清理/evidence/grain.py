from pathlib import Path
from PIL import Image,ImageDraw,ImageEnhance,ImageStat
import json
root=Path(__file__).resolve().parent
box=(1800,800,2120,1000)
sheet=Image.new('RGB',(1920,850),'white'); pen=ImageDraw.Draw(sheet)
stats=[]
for col,label in enumerate(['reference','cq28','50m']):
    image=Image.open(root/f'3-{label}-worst.png').convert('RGB').crop(box)
    stats.append({'label':label,'box':box,'stddevRGB':ImageStat.Stat(image).stddev})
    for row in range(2):
        crop=ImageEnhance.Contrast(image).enhance(6) if row else image
        sheet.paste(crop.resize((640,400),Image.Resampling.NEAREST),(col*640,row*425+22))
        pen.text((col*640+8,row*425+4),f'{label} / 200% / white surface grain'+(' / contrast x6' if row else ''),fill='black')
sheet.save(root/'3-grain-comparison.png')
(root/'grain-stats.json').write_text(json.dumps(stats,indent=2),'utf-8')
