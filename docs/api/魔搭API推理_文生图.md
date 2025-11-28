### 文生图模型#

支持API调用的模型列表，可以通过[AIGC模型](https://www.modelscope.cn/aigc/models)页面进行搜索。 API的调用示例如下:
```
import requests
import time
import json
from PIL import Image
from io import BytesIO

base_url = 'https://api-inference.modelscope.cn/'
api_key = "<MODELSCOPE_SDK_TOKEN>"

common_headers = {
    "Authorization": f"Bearer {api_key}",
    "Content-Type": "application/json",
}

response = requests.post(
    f"{base_url}v1/images/generations",
    headers={**common_headers, "X-ModelScope-Async-Mode": "true"},
    data=json.dumps({
        "model": "black-forest-labs/FLUX.1-Krea-dev",  # ModelScope Model-Id, required
        "prompt": "A golden cat"
    }, ensure_ascii=False).encode('utf-8')
)

response.raise_for_status()
task_id = response.json()["task_id"]

while True:
    result = requests.get(
        f"{base_url}v1/tasks/{task_id}",
        headers={**common_headers, "X-ModelScope-Task-Type": "image_generation"},
    )
    result.raise_for_status()
    data = result.json()

    if data["task_status"] == "SUCCEED":
        image = Image.open(BytesIO(requests.get(data["output_images"][0]).content))
        image.save("result_image.jpg")
        break
    elif data["task_status"] == "FAILED":
        print("Image Generation Failed.")
        break

    time.sleep(5)
```
| 参数名 | 参数说明 | 是否必须 | 参数类型 | 示例 | 取值范围 |
| --- | --- | --- | --- | --- | --- |
| model | 模型id | 是 | string | MAILAND/majicflus_v1 | ModelScope上的AIGC模型ID |
| prompt | 正向提示词，大部分模型建议使用英文提示词效果较好。 | 是 | string | A mysterious girl walking down the corridor. | 长度小于2000 |
| negative_prompt | 负向提示词 | 否 | string | lowres, bad anatomy, bad hands, text, error, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality, normal quality, jpeg artifacts, signature, watermark, username, blurry | 长度小于2000 |
| size | 生成图像分辨率大小 | 否 | string | 1024x1024 | 分辨率范围: SD系列: [64x64,2048x2048], FLUX: [64x64,1024x1024], Qwen-Image: [64x64,1664x1664] |
| seed | 随机种子 | 否 | int | 12345 | [0,2^31-1] |
| steps | 采样步数 | 否 | int | 30 | [1,100] |
| guidance | 提示词引导系数 | 否 | float | 3.5 | [1.5,20] |
| image_url | 待编辑图片的url地址，该参数只适用于支持图片编辑的模型 | 否 | string | https://resources.modelscope.cn/aigc/image_edit.png | 确保公网可访问 |