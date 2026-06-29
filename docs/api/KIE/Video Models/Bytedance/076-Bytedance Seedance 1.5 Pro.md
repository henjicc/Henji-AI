# Bytedance Seedance 1.5 Pro

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
      summary: Bytedance Seedance 1.5 Pro
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


        ::: note[]

        **音频生成说明**：启用 `generate_audio` 功能会增加生成费用。仅在视频内容确实需要音频时使用此功能。

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
      operationId: bytedance-seedance-1-5-pro
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
              properties:
                model:
                  type: string
                  enum:
                    - bytedance/seedance-1.5-pro
                  default: bytedance/seedance-1.5-pro
                  description: |-
                    用于生成任务的模型名称。必填字段。

                    - 该接口必须使用 `bytedance/seedance-1.5-pro` 模型
                  examples:
                    - bytedance/seedance-1.5-pro
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
                    input_urls:
                      description: |-
                        用于图生视频的输入图片 URL。可选字段。

                        - 支持 0-2 张图片
                        - 若不提供，模型将执行文生视频
                        - 需为上传后的文件 URL，而非文件内容
                        - 支持的格式：image/jpeg、image/png、image/webp
                        - 单张图片最大大小：10.0MB
                      type: array
                      items:
                        type: string
                        format: uri
                      maxItems: 2
                      examples:
                        - - >-
                            https://file.aiquickdraw.com/custom-page/akr/section-images/example1.png
                    aspect_ratio:
                      description: 视频画面比例配置。必填字段。
                      type: string
                      enum:
                        - '1:1'
                        - '4:3'
                        - '3:4'
                        - '16:9'
                        - '9:16'
                        - '21:9'
                      default: '1:1'
                      examples:
                        - '1:1'
                    resolution:
                      description: 视频分辨率 - 480p 生成速度更快，720p 兼顾速度与画质，1080p 画质更高
                      type: string
                      enum:
                        - 480p
                        - 720p
                        - 1080p
                      default: 720p
                      examples:
                        - 720p
                    duration:
                      type: number
                      description: '视频时长（单位：秒）, 可选区间: 4-12秒'
                    fixed_lens:
                      description: |-
                        Seedance 增加了动态摄像机移动功能。启用此功能可锁定摄像机，实现稳定的静态拍摄。

                        - **true**: 锁定摄像机，实现静态拍摄
                        - **false**: 允许动态摄像机移动
                      type: boolean
                      default: false
                      examples:
                        - false
                    generate_audio:
                      description: |-
                        是否为视频生成音频。

                        - **true**: 生成带音频的视频（费用更高）
                        - **false**: 生成无音频的视频

                        注意：启用音频生成会增加生成费用
                      type: boolean
                      default: false
                      examples:
                        - false
                    nsfw_checker:
                      type: boolean
                      description: Playground 中默认启用。对于 API 调用，您可以根据需要启用或禁用此功能。
                  required:
                    - prompt
                    - aspect_ratio
                    - duration
                  x-apidog-orders:
                    - prompt
                    - input_urls
                    - aspect_ratio
                    - resolution
                    - duration
                    - fixed_lens
                    - generate_audio
                    - nsfw_checker
                  x-apidog-ignore-properties: []
              x-apidog-orders:
                - model
                - callBackUrl
                - input
              x-apidog-ignore-properties: []
            example:
              model: bytedance/seedance-1.5-pro
              callBackUrl: https://your-domain.com/api/callback
              input:
                prompt: 宁静的海滩日落景色，海浪轻柔地拍打着岸边，棕榈树在微风中摇曳，海鸥飞过橙色的天空
                input_urls:
                  - >-
                    https://file.aiquickdraw.com/custom-page/akr/section-images/example1.png
                aspect_ratio: '1:1'
                resolution: 720p
                duration: 8
                fixed_lens: false
                generate_audio: false
                nsfw_checker: false
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
      x-run-in-apidog: https://app.apidog.com/web/project/1184766/apis/api-28506670-run
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
