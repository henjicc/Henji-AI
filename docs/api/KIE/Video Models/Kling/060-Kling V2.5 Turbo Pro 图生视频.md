# Kling V2.5 Turbo Pro 图生视频

## OpenAPI Specification

```yaml
openapi: 3.0.1
info:
  title: ''
  description: ''
  version: 1.0.0
paths:
  /api/v1/jobs/createTask:
    post:
      summary: Kling V2.5 Turbo Pro 图生视频
      deprecated: false
      description: >-
        ## 查询任务状态


        提交任务后，可通过统一的查询端点查看任务进度并获取生成结果：


        <Card title="Get Task Details" icon="magnifying-glass"
        href="/cn/market/common/get-task-detail">
          了解如何查询任务状态并获取生成结果
        </Card>


        ::: tip[]

        生产环境中，建议使用 `callBackUrl` 参数接收生成完成的自动通知，而非轮询状态端点。

        :::


        ## 相关资源


        <CardGroup cols={2}>
          <Card title="Market Overview" icon="store" href="/cn/market/quickstart">
            浏览所有可用模型
          </Card>
          <Card title="Common API" icon="gear" href="/cn/common-api/get-account-credits">
            查看账户积分与使用情况
          </Card>
        </CardGroup>
      operationId: kling-v2-5-turbo-image-to-video-pro
      tags:
        - docs/zh-CN/Market/Video Models/Kling
      parameters: []
      requestBody:
        content:
          application/json:
            schema:
              type: object
              required:
                - model
              properties:
                model:
                  type: string
                  enum:
                    - kling/v2-5-turbo-image-to-video-pro
                  default: kling/v2-5-turbo-image-to-video-pro
                  description: |-
                    用于生成任务的模型名称。必填字段。

                    - 该端点必须使用 `kling/v2-5-turbo-image-to-video-pro` 模型
                  examples:
                    - kling/v2-5-turbo-image-to-video-pro
                callBackUrl:
                  type: string
                  format: uri
                  description: |-
                    接收生成任务完成通知的回调 URL。可选配置，建议在生产环境中使用。

                    - 任务生成完成后，系统会向该 URL POST 任务状态与结果
                    - 回调内容包含生成视频的 URL 与任务相关信息
                    - 您的回调端点需要支持接收带 JSON 负载的 POST 请求
                    - 也可以选择调用任务详情端点，主动轮询任务状态
                  examples:
                    - https://your-domain.com/api/callback
                input:
                  type: object
                  description: 生成任务的输入参数
                  properties:
                    prompt:
                      description: 视频生成的文本描述（最大长度：2500 字符）
                      type: string
                      maxLength: 2500
                      examples:
                        - >-
                          宇航员瞬间穿过散发着光芒的魔法木门完成瞬移。采用手持跟踪镜头，相机保持在宇航员斜后上方 5–10
                          米处，呈现流畅的第三人称追逐视角。整体画面以超写实为基底，每个场景具备独特艺术风格，场景切换时伴随明亮的传送门光晕闪帧效果，细节拉满，8K
                          分辨率，搭配史诗级管弦乐背景音。通过高帧率插值实现流畅的动态效果与利落的瞬间转场。特写镜头：身着白色宇航服的宇航员从脚下发光的传送门中急速坠落。

                          第一次转场：乐高风格阿尔卑斯山，高饱和度日光下，雪山峰峦与山谷尽收眼底，宇航员坠落过程中，下一个传送门开启。

                          第二次转场：亚马逊雨林，茂密的树冠与河流在下方延展，宇航员坠落，传送门再次开启。

                          第三次转场：古埃及风格，壁画质感的吉萨金字塔，沙漠与尼罗河铺展于下，宇航员坠落，传送门开启。

                          第四次转场：抽象黑白水墨风格，下方是中国长城，宇航员坠落，最后一个传送门开启。

                          第五次转场：纽约夜景，写实风格的深色城市天际线，璀璨的城市灯光与帝国大厦相映，宇航员优雅悬停。全程相机保持固定距离，轻微环绕运动，流畅的第三人称跟踪视角贯穿始终。每次传送门转场均伴随锐利的闪光，凸显速度感与魔幻的旅程体验，艺术风格与场景位置的切换极具冲击力。
                    image_url:
                      description: >-
                        用于生成视频的图像 URL（为上传后的文件
                        URL，非文件内容；支持的类型：image/jpeg、image/png；最大文件大小：10.0MB）
                      type: string
                      examples:
                        - >-
                          https://file.aiquickdraw.com/custom-page/akr/section-images/1759211376283gfcw5zcy.png
                    tail_image_url:
                      description: >-
                        视频结尾帧图像 URL（为上传后的文件
                        URL，非文件内容；支持的类型：image/jpeg、image/png；最大文件大小：10.0MB）
                      type: string
                      examples:
                        - ''
                    duration:
                      description: 生成视频的时长（单位：秒）
                      type: string
                      enum:
                        - '5'
                        - '10'
                      default: '5'
                      examples:
                        - '5'
                    negative_prompt:
                      description: 视频中需要规避的元素（最大长度：2496 字符）
                      type: string
                      maxLength: 2496
                      examples:
                        - 模糊、失真、画质低下
                    cfg_scale:
                      description: CFG（无分类器引导）系数，用于控制模型贴合提示词的程度（最小值：0，最大值：1，步长：0.1）
                      type: number
                      minimum: 0
                      maximum: 1
                      default: 0.5
                      examples:
                        - 0.5
                  required:
                    - prompt
                    - image_url
                  x-apidog-orders:
                    - prompt
                    - image_url
                    - tail_image_url
                    - duration
                    - negative_prompt
                    - cfg_scale
                  x-apidog-ignore-properties: []
              x-apidog-orders:
                - model
                - callBackUrl
                - input
              x-apidog-ignore-properties: []
            example:
              model: kling/v2-5-turbo-image-to-video-pro
              callBackUrl: https://your-domain.com/api/callback
              input:
                prompt: >-
                  宇航员瞬间穿过散发着光芒的魔法木门完成瞬移。采用手持跟踪镜头，相机保持在宇航员斜后上方 5–10
                  米处，呈现流畅的第三人称追逐视角。整体画面以超写实为基底，每个场景具备独特艺术风格，场景切换时伴随明亮的传送门光晕闪帧效果，细节拉满，8K
                  分辨率，搭配史诗级管弦乐背景音。通过高帧率插值实现流畅的动态效果与利落的瞬间转场。特写镜头：身着白色宇航服的宇航员从脚下发光的传送门中急速坠落。

                  第一次转场：乐高风格阿尔卑斯山，高饱和度日光下，雪山峰峦与山谷尽收眼底，宇航员坠落过程中，下一个传送门开启。

                  第二次转场：亚马逊雨林，茂密的树冠与河流在下方延展，宇航员坠落，传送门再次开启。

                  第三次转场：古埃及风格，壁画质感的吉萨金字塔，沙漠与尼罗河铺展于下，宇航员坠落，传送门开启。

                  第四次转场：抽象黑白水墨风格，下方是中国长城，宇航员坠落，最后一个传送门开启。

                  第五次转场：纽约夜景，写实风格的深色城市天际线，璀璨的城市灯光与帝国大厦相映，宇航员优雅悬停。全程相机保持固定距离，轻微环绕运动，流畅的第三人称跟踪视角贯穿始终。每次传送门转场均伴随锐利的闪光，凸显速度感与魔幻的旅程体验，艺术风格与场景位置的切换极具冲击力。
                image_url: >-
                  https://file.aiquickdraw.com/custom-page/akr/section-images/1759211376283gfcw5zcy.png
                tail_image_url: ''
                duration: '5'
                negative_prompt: 模糊、失真、画质低下
                cfg_scale: 0.5
      responses:
        '200':
          description: 请求成功
          content:
            application/json:
              schema:
                allOf:
                  - $ref: '#/components/schemas/ApiResponse'
              example:
                code: 200
                msg: success
                data:
                  taskId: task_kling_1765184408908
          headers: {}
          x-apidog-name: ''
      security:
        - BearerAuth: []
          x-apidog:
            schemeGroups:
              - id: kn8M4YUlc5i0A0179ezwx
                schemeIds:
                  - BearerAuth
            required: true
            use:
              id: kn8M4YUlc5i0A0179ezwx
            scopes:
              kn8M4YUlc5i0A0179ezwx:
                BearerAuth: []
      x-apidog-folder: docs/zh-CN/Market/Video Models/Kling
      x-apidog-status: released
      x-run-in-apidog: https://app.apidog.com/web/project/1184766/apis/api-28506660-run
components:
  schemas:
    ApiResponse:
      type: object
      properties:
        code:
          type: integer
          description: |-
            响应状态码
            200: 成功 - 请求已成功处理
            401: 未授权 - 缺少身份验证凭据或凭据无效
            402: 额度不足 - 账户额度不足，无法执行该操作
            404: 未找到 - 请求的资源或接口不存在
            422: 校验错误 - 请求参数未通过校验检查
            429: 请求受限 - 已超过该资源的请求频率限制
            433: 请求限额 - 子 key 使用超出限额
            455: 服务不可用 - 系统目前正在维护中
            500: 服务器错误 - 处理请求时发生了意外错误
            501: 生成失败 - 内容生成任务失败
            505: 功能禁用 - 请求的功能目前已禁用
          enum:
            - 200
            - 401
            - 402
            - 404
            - 422
            - 429
            - 433
            - 455
            - 500
            - 501
            - 505
          x-apidog-enum:
            - value: 200
              name: ''
              description: ''
            - value: 401
              name: ''
              description: ''
            - value: 402
              name: ''
              description: ''
            - value: 404
              name: ''
              description: ''
            - value: 422
              name: ''
              description: ''
            - value: 429
              name: ''
              description: ''
            - value: 433
              name: ''
              description: ''
            - value: 455
              name: ''
              description: ''
            - value: 500
              name: ''
              description: ''
            - value: 501
              name: ''
              description: ''
            - value: 505
              name: ''
              description: ''
        msg:
          type: string
          description: 响应消息，失败时的错误描述
        data:
          type: object
          properties:
            taskId:
              type: string
              description: 任务 ID 可与“获取任务详细信息”端点一起使用，以查询任务状态
          x-apidog-orders:
            - taskId
          required:
            - taskId
          x-apidog-ignore-properties: []
      x-apidog-orders:
        - code
        - msg
        - data
      required:
        - code
        - msg
        - data
      title: response not with recordId
      x-apidog-ignore-properties: []
      x-apidog-folder: ''
  securitySchemes:
    BearerAuth:
      type: bearer
      scheme: bearer
      bearerFormat: API Key
      description: >-
        All API requests require a Bearer Token. Add the header `Authorization:
        Bearer YOUR_API_KEY` to authenticate requests.
    BearerAuth1:
      type: bearer
      scheme: bearer
      bearerFormat: API Key
      description: >-
        所有 API 请求都需要 Bearer Token。请在请求头中添加 `Authorization: Bearer YOUR_API_KEY`
        进行身份验证。
servers:
  - url: https://api.kie.ai
    description: 正式环境
security:
  - BearerAuth: []
    x-apidog:
      schemeGroups:
        - id: kn8M4YUlc5i0A0179ezwx
          schemeIds:
            - BearerAuth
      required: true
      use:
        id: kn8M4YUlc5i0A0179ezwx
      scopes:
        kn8M4YUlc5i0A0179ezwx:
          BearerAuth: []

```
