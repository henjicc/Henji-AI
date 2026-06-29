# OmniHuman 1.5

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
      summary: OmniHuman 1.5
      deprecated: false
      description: >-
        ## 创建任务


        调用该接口可创建一个新的音频驱动肖像动画任务。上传一张肖像图片和一段音频文件，模型将生成主体随音频说话或运动的视频。


        <Card title="查询任务详情" icon="lucide-search"
        href="/market/common/get-task-detail">
          提交任务后，可通过统一查询接口查看任务进度并获取生成结果
        </Card>


        ::: tip[]

        生产环境建议优先使用 `callBackUrl` 参数接收任务完成通知，而不是持续轮询任务状态接口。

        :::


        ## 文件上传


        ::: tip[]

        调用该接口前需要先上传文件？请参阅 [文件上传 API 快速入门](/file-upload-api/quickstart)。

        :::


        ## 相关资源


        <CardGroup cols={2}>
          <Card title="模型市场" icon="lucide-store" href="/market/quickstart">
            浏览全部可用模型与能力
          </Card>
          <Card title="通用 API" icon="lucide-cog" href="/common-api/get-account-credits">
            查看账户积分与调用情况
          </Card>
        </CardGroup>
      operationId: omnihuman-1-5-zh
      tags:
        - docs/zh-CN/Market/Video Models/Omnihuman 1.5
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
                  enum:
                    - omnihuman-1-5
                  default: omnihuman-1-5
                  description: |-
                    用于生成的模型名称。必填字段。

                    - 该端点必须使用 `omnihuman-1-5` 模型
                  examples:
                    - omnihuman-1-5
                input:
                  type: object
                  description: 音频驱动肖像动画任务的输入参数。
                  required:
                    - image_url
                    - audio_url
                  properties:
                    image_url:
                      type: string
                      format: uri
                      description: >-
                        肖像图片
                        URL。支持任意宽高比，主体可以是人物、宠物、动漫角色等。支持的文件类型：image/jpeg、image/png、image/webp。最大文件大小：10MB。
                    mask_url:
                      type: array
                      items:
                        type: string
                        format: uri
                      maxItems: 5
                      description: >-
                        可选的蒙版图片
                        URL。如需让图片中的特定主体说话，请使用「主体检测」功能获取对应的蒙版图片并作为输入传入。支持的文件类型：image/jpeg、image/png、image/webp。最大文件大小：10MB。支持多文件上传，最多
                        5 个文件。
                    audio_url:
                      type: string
                      format: uri
                      description: >-
                        音频 URL。时长必须小于 60 秒（建议 15
                        秒以内；超过此时长会导致质量下降）。支持的文件类型：audio/mpeg、audio/wav、audio/x-wav、audio/aac、audio/ogg、audio/mp4。最大文件大小：10MB。
                    prompt:
                      type: string
                      maxLength: 1000
                      description: 可选的提示文本。仅限中文、英文、日文、韩文、西班牙文和印尼文，建议 300 字符以内。最大长度：1000 字符。
                    output_resolution:
                      type: string
                      enum:
                        - '720'
                        - '1080'
                      default: '1080'
                      description: |-
                        输出视频分辨率。

                        - `720`：720P
                        - `1080`：1080P（默认）
                    pe_fast_mode:
                      type: boolean
                      default: false
                      description: 快速模式。牺牲部分质量以加快生成速度。默认值：`false`。
                    seed:
                      type: integer
                      default: -1
                      description: 随机种子。默认为 `-1`（随机）。使用相同的正整数且其他参数完全一致时，生成结果将高度一致。
                  x-apidog-orders:
                    - image_url
                    - mask_url
                    - audio_url
                    - prompt
                    - output_resolution
                    - pe_fast_mode
                    - seed
                callBackUrl:
                  type: string
                  format: uri
                  description: 回调 URL。任务完成后，kie 会将结果发送到该业务回调地址。
              x-apidog-orders:
                - model
                - input
                - callBackUrl
            example:
              model: omnihuman-1-5
              input:
                image_url: https://your-domain.com/image/portrait.png
                mask_url:
                  - https://your-domain.com/image/mask.png
                audio_url: https://your-domain.com/audio/speech.mp3
                prompt: 一个人自然地说话，表情温和。
                output_resolution: '1080'
                pe_fast_mode: false
                seed: -1
              callBackUrl: https://your-domain.com/api/callback
      responses:
        '200':
          description: 请求成功
          content:
            application/json:
              schema:
                allOf:
                  - type: object
                    properties: {}
                  - type: object
                    properties:
                      data:
                        type: object
                        properties:
                          taskId:
                            type: string
                            description: 任务 ID，可通过任务详情接口查询任务状态。
                            examples:
                              - task_omnihuman-1-5_1234567890
                        x-apidog-orders:
                          - taskId
                    x-apidog-orders:
                      - data
              example:
                code: 200
                msg: success
                data:
                  taskId: task_omnihuman-1-5_1234567890
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
      x-apidog-folder: docs/zh-CN/Market/Video Models/Omnihuman 1.5
      x-apidog-status: released
      x-run-in-apidog: https://app.apidog.com/web/project/1184766/apis/api-37875329-run
components:
  schemas: {}
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
