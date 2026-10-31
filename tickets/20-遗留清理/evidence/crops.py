from pathlib import Path
from PIL import Image, ImageDraw, ImageEnhance
root=Path(__file__).resolve().parent
boxes=[(720,960,1040,1160),(760,820,1080,1020),(2048,448,2368,648),(1550,1100,1870,1300)]
for n,box in enumerate(boxes):
    sheet=Image.new('RGB',(1920,1280),'white')
    pen=ImageDraw.Draw(sheet)
    for col,label in enumerate(['reference','cq28','50m']):
        image=Image.open(root/f'{n}-{label}-worst.png').convert('RGB')
        for row,(region,enhance) in enumerate([(box,False),((64,64,384,264),False),((64,64,384,264),True)]):
            crop=image.crop(region)
            if enhance: crop=ImageEnhance.Contrast(crop).enhance(6)
            crop=crop.resize((640,400),Image.Resampling.NEAREST)
            y=row*425
            pen.text((col*640+8,y+4),f'{label} / 200% / '+('detail' if row==0 else 'dark background'+(' contrast x6' if enhance else '')),fill='black')
            sheet.paste(crop,(col*640,y+22))
    sheet.save(root/f'{n}-comparison.png')
