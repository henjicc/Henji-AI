# Bytedance Seedance 2.0 Mini

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
      summary: Bytedance Seedance 2.0 Mini
      deprecated: false
      description: >
        ## 查询任务状态


        提交任务后，可通过统一的查询接口查看任务进度并获取结果：


        <Card title="Get Task Details" icon="magnifying-glass"
        href="/cn/market/common/get-task-detail">
          了解如何查询任务状态并获取生成结果
        </Card>



        ::: tip[]

        生产环境中，建议使用 `callBackUrl` 参数接收生成完成的自动通知，而非轮询状态接口。

        :::


        > **注意**

        >

        > *   **图生视频-首帧**、**图生视频-首尾帧**、**多模态参考生视频**（包括参考图、视频、音频）为 3
        种互斥场景，**不可混用**。

        > *  
        多模态参考生视频可通过提示词指定参考图片作为首帧/尾帧，间接实现“首尾帧+多模态参考”效果。若需严格保障首尾帧和指定图片一致，**优先使用图生视频-首尾帧**。



        ## 核心功能


        <CardGroup cols={2}>
          <Card title="文生视频" icon="wand-magic-sparkles">
            直接从文本描述生成视频，无需提供输入图片
          </Card>
          <Card title="图生视频" icon="images">
            为静态图片添加动画效果，支持 0-2 张输入图片
          </Card>
          <Card title="动态摄像机" icon="camera">
            先进的摄像机运动控制，可选锁定镜头实现稳定拍摄
          </Card>
          <Card title="音频生成" icon="volume-high">
            可选音频生成功能，增强视频内容表现力
          </Card>
        </CardGroup>




        ## 相关资源


        <CardGroup cols={2}>
          <Card title="Market Overview" icon="store" href="/cn/market/quickstart">
            浏览所有可用模型
          </Card>
          <Card title="Common API" icon="gear" href="/cn/common-api/get-account-credits">
            查看账户积分与使用情况
          </Card>
        </CardGroup>
      operationId: bytedance-seedance-2-fast
      tags:
        - docs/zh-CN/Market/Video Models/Bytedance
      parameters: []
      requestBody:
        content:
          application/json:
            schema:
              type: object
              required:
                - model
                - input
              properties:
                model:
                  type: string
                  description: |-
                    用于生成任务的模型名称。必填字段。

                    - 该接口必须使用 `bytedance/seedance-2-mini` 模型
                  enum:
                    - bytedance/seedance-2-fast
                  default: bytedance/seedance-2-fast
                  x-apidog-enum:
                    - value: bytedance/seedance-2-fast
                      name: ''
                      description: ''
                  examples:
                    - bytedance/seedance-2-fast
                callBackUrl:
                  type: string
                  format: uri
                  description: |-
                    接收生成任务完成通知的回调 URL。可选配置，生产环境建议使用。

                    - 任务生成完成后，系统会向该 URL 以 POST 方式推送任务状态和结果
                    - 回调内容包含生成内容的 URL 及任务相关信息
                    - 你的回调接口需支持接收 POST 请求及 JSON 格式的请求体
                    - 也可选择调用任务详情接口，主动轮询任务状态
                  examples:
                    - https://your-domain.com/api/callback
                input:
                  type: object
                  description: 生成任务的输入参数
                  properties:
                    prompt:
                      type: string
                      description: 用于视频生成的文本提示词。必填字段。（最小长度：3，最大长度：20000 字符）
                      minLength: 3
                      maxLength: 20000
                      examples:
                        - 宁静的海滩日落景色，海浪轻柔地拍打着岸边，棕榈树在微风中摇曳，海鸥飞过橙色的天空
                    first_frame_url:
                      type: string
                      description: |-
                        首帧图片或者asset://{assetId} 
                        (例如: asset://asset-20260404242101-76djj)
                    last_frame_url:
                      type: string
                      description: |-
                        尾帧图片或者asset://{assetId} 
                        (例如: asset://asset-20260404242101-76djj)
                    reference_image_urls:
                      type: array
                      items:
                        type: string
                        format: uri
                      description: |-
                        输入图像 URL或者asset://{assetId} 
                        (例如: asset://asset-20260404242101-76djj) 列表。
                        传入单张图片要求:
                        格式：jpeg、png、webp、bmp、tiff、gif。
                        宽高比（宽/高）： (0.4, 2.5) 
                        宽高长度（px）：(300, 6000)
                        大小：单张图片小于 30 MB。
                        最大文件数：和首尾帧张数之和不得超过9张。
                      maxItems: 9
                      examples:
                        - - >-
                            https://file.aiquickdraw.com/custom-page/akr/section-images/example1.png
                    reference_video_urls:
                      type: array
                      items:
                        type: string
                        format: uri
                      description: >-
                        输入视频网址或者asset://{assetId} 

                        (例如: asset://asset-20260404242101-76djj)列表。

                        单个视频要求:

                        视频格式：mp4、mov。

                        分辨率：480p、720p

                        时长：单个视频时长 [2, 15] s，最多传入 3 个参考视频，所有视频总时长不超过 15s。

                        尺寸：

                        宽高比（宽/高）：[0.4, 2.5]

                        宽高长度（px）：[300, 6000]

                        总像素数：[640×640=409600, 834×1112=927408]，即宽和高的乘积符合
                        [409600, 927408] 的区间要求。

                        大小：单个视频不超过 50 MB。

                        帧率 (FPS)：[24, 60] 
                      maxItems: 3
                    reference_audio_urls:
                      type: array
                      items:
                        type: string
                        format: uri
                      description: |-
                        输入音频 URL 或者asset://{assetId} 
                        (例如: asset://asset-20260404242101-76djj)列表。
                        单个音频要求:
                        格式：wav、mp3
                        时长：单个音频时长 [2, 15] s，最多传入 3 段参考音频，所有音频总时长不超过 15 s。
                        大小：单个音频不超过 15 MB。
                      maxItems: 3
                    generate_audio:
                      type: boolean
                      description: 是否生成与画面同步的音频，仅部分模型支持
                      default: true
                    resolution:
                      type: string
                      description: 视频分辨率 - 480p 生成速度更快，720p 兼顾速度与画质
                      enum:
                        - 480p
                        - 720p
                      default: 720p
                      examples:
                        - 720p
                      x-apidog-enum:
                        - value: 480p
                          name: ''
                          description: ''
                        - value: 720p
                          name: ''
                          description: ''
                    aspect_ratio:
                      type: string
                      description: 视频画面比例配置。
                      enum:
                        - '1:1'
                        - '4:3'
                        - '3:4'
                        - '16:9'
                        - '9:16'
                        - '21:9'
                        - adaptive
                      default: '16:9'
                      x-apidog-enum:
                        - value: '1:1'
                          name: ''
                          description: ''
                        - value: '4:3'
                          name: ''
                          description: ''
                        - value: '3:4'
                          name: ''
                          description: ''
                        - value: '16:9'
                          name: ''
                          description: ''
                        - value: '9:16'
                          name: ''
                          description: ''
                        - value: '21:9'
                          name: ''
                          description: ''
                        - value: adaptive
                          name: ''
                          description: ''
                      examples:
                        - '16:9'
                    duration:
                      type: integer
                      description: 视频时长4-15（秒）。
                      default: 5
                      examples:
                        - 5
                    web_search:
                      type: boolean
                      description: 是否启用联网搜索
                    nsfw_checker:
                      type: boolean
                      description: >-
                        默认值为 false。您可以根据需要将其设置为 false。如果设置为
                        false，我们的内容过滤功能将被禁用，所有结果将由模型直接返回。
                      default: false
                  x-apidog-orders:
                    - prompt
                    - first_frame_url
                    - last_frame_url
                    - reference_image_urls
                    - reference_video_urls
                    - reference_audio_urls
                    - generate_audio
                    - resolution
                    - aspect_ratio
                    - duration
                    - web_search
                    - nsfw_checker
                  x-apidog-ignore-properties: []
              x-apidog-orders:
                - model
                - callBackUrl
                - input
              x-apidog-ignore-properties: []
            example:
              model: bytedance/seedance-2-mini
              callBackUrl: https://your-domain.com/api/callback
              input:
                prompt: 宁静的海滩日落景色，海浪轻柔地拍打着岸边，棕榈树在微风中摇曳，海鸥飞过橙色的天空
                first_frame_url: >-
                  https://templateb.aiquickdraw.com/custom-page/akr/section-images/example2.png
                last_frame_url: >-
                  https://templateb.aiquickdraw.com/custom-page/akr/section-images/example3.png
                reference_image_urls:
                  - >-
                    https://templateb.aiquickdraw.com/custom-page/akr/section-images/example1.png
                reference_video_urls:
                  - >-
                    https://templateb.aiquickdraw.com/custom-page/akr/section-images/example1.mp4
                reference_audio_urls:
                  - >-
                    https://templateb.aiquickdraw.com/custom-page/akr/section-images/example1.mp3
                return_last_frame: false
                generate_audio: false
                resolution: 720p
                aspect_ratio: '16:9'
                duration: 15
                web_search: true
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
                  taskId: task_bytedance_1765186743319
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
      x-apidog-folder: docs/zh-CN/Market/Video Models/Bytedance
      x-apidog-status: released
      x-run-in-apidog: https://app.apidog.com/web/project/1184766/apis/api-38321786-run
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
