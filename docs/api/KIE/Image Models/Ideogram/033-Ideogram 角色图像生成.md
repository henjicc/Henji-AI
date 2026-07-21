# Ideogram 角色图像生成

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
      summary: Ideogram 角色图像生成
      deprecated: false
      description: >-
        基于 ideogram/character 模型实现图像生成


        ## 查询任务状态


        提交任务后，可通过统一的查询端点查看任务进度并获取生成结果：


        <Card title="获取任务详情" icon="lucide-search"
        href="/cn/market/common/get-task-detail">
          了解如何查询任务状态并获取生成结果
        </Card>


        ::: tip[]

        生产环境中，建议使用 `callBackUrl` 参数接收生成完成的自动通知，而非轮询状态端点。

        :::


        ## 相关资源


        <CardGroup cols={2}>
          <Card title="市场概览" icon="lucide-store" href="/cn/market/quickstart">
            浏览所有可用模型
          </Card>
          <Card title="通用 API" icon="lucide-cog" href="/cn/common-api/get-account-credits">
            查看账户积分与使用情况
          </Card>
        </CardGroup>
      operationId: ideogram-character
      tags:
        - docs/zh-CN/Market/Image    Models/Ideogram
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
                    - ideogram/character
                  default: ideogram/character
                  description: |-
                    用于生成任务的模型名称。必填字段。

                    - 该端点必须使用 `ideogram/character` 模型
                  examples:
                    - ideogram/character
                callBackUrl:
                  type: string
                  format: uri
                  description: >-
                    接收生成任务完成通知的回调 URL。可选配置，建议在生产环境中使用。


                    - 任务生成完成后，系统会向该 URL POST 任务状态与结果

                    - 回调内容包含生成的资源 URL 与任务相关信息

                    - 您的回调端点需要支持接收带 JSON 负载的 POST 请求

                    - 也可以选择调用任务详情端点，主动轮询任务状态

                    - 为确保回调安全性，请参阅 [Webhook
                    校验指南](/cn/common-api/webhook-verification) 了解签名验证实现方法
                  examples:
                    - https://your-domain.com/api/callback
                input:
                  type: object
                  description: 生成任务的输入参数
                  properties:
                    prompt:
                      description: 用于填充图像蒙版区域的文本提示词（最大长度：5000 字符）
                      type: string
                      maxLength: 5000
                      examples:
                        - >-
                          将上传肖像中的这位女性（身着休闲白衬衫）置于宁静的花园场景中。画面需呈现生机盎然的绿植与缤纷花卉，柔和的阳光透过枝叶洒落。她坐在木质长椅上，手持书本，浅笑嫣然。背景被葱郁的绿植填满，营造出静谧祥和的氛围。午后的金色光线勾勒出她的脸庞，在地面投下柔和的阴影，为整个画面增添悠然、沉思的意境。
                    reference_image_urls:
                      description: >-
                        作为人物参考的图像集合。目前仅支持 1 张图像，其余图像将被忽略。（所有参考图像总大小不超过
                        10MB）。图像格式需为 JPEG、PNG 或 WebP（为上传后的文件
                        URL，非文件内容；支持的类型：image/jpeg、image/png、image/webp；最大文件大小：10.0MB）
                      type: array
                      items:
                        type: string
                        format: uri
                      examples:
                        - - >-
                            https://file.aiquickdraw.com/custom-page/akr/section-images/1755767145415pvz49dpi.webp
                    rendering_speed:
                      description: 渲染速度。默认值："BALANCED"
                      type: string
                      enum:
                        - TURBO
                        - BALANCED
                        - QUALITY
                      default: BALANCED
                      examples:
                        - BALANCED
                    style:
                      description: 生成图像的风格类型。不可与 style_codes 同时使用。默认值："AUTO"
                      type: string
                      enum:
                        - AUTO
                        - REALISTIC
                        - FICTION
                      default: AUTO
                      examples:
                        - AUTO
                    expand_prompt:
                      description: 是否启用 MagicPrompt 功能优化生成请求。默认值：true（布尔值：true/false）
                      type: boolean
                      examples:
                        - true
                    num_images:
                      description: 生成图像数量
                      type: string
                      enum:
                        - '1'
                        - '2'
                        - '3'
                        - '4'
                      default: '1'
                      examples:
                        - '1'
                    image_size:
                      description: 生成图像的分辨率规格。默认值：square_hd
                      type: string
                      enum:
                        - square
                        - square_hd
                        - portrait_4_3
                        - portrait_16_9
                        - landscape_4_3
                        - landscape_16_9
                      default: square_hd
                      examples:
                        - square_hd
                    seed:
                      description: 随机数生成器的种子值
                      type: integer
                    negative_prompt:
                      description: 需从生成图像中排除的内容描述。提示词中的描述优先级高于反向提示词。默认值：""（最大长度：5000 字符）
                      type: string
                      maxLength: 5000
                      examples:
                        - ''
                  required:
                    - prompt
                    - reference_image_urls
                  x-apidog-orders:
                    - prompt
                    - reference_image_urls
                    - rendering_speed
                    - style
                    - expand_prompt
                    - num_images
                    - image_size
                    - seed
                    - negative_prompt
                  x-apidog-ignore-properties: []
              x-apidog-orders:
                - model
                - callBackUrl
                - input
              x-apidog-ignore-properties: []
            example:
              model: ideogram/character
              callBackUrl: https://your-domain.com/api/callback
              input:
                prompt: >-
                  将上传肖像中的这位女性（身着休闲白衬衫）置于宁静的花园场景中。画面需呈现生机盎然的绿植与缤纷花卉，柔和的阳光透过枝叶洒落。她坐在木质长椅上，手持书本，浅笑嫣然。背景被葱郁的绿植填满，营造出静谧祥和的氛围。午后的金色光线勾勒出她的脸庞，在地面投下柔和的阴影，为整个画面增添悠然、沉思的意境。
                reference_image_urls:
                  - >-
                    https://file.aiquickdraw.com/custom-page/akr/section-images/1755767145415pvz49dpi.webp
                rendering_speed: BALANCED
                style: AUTO
                expand_prompt: true
                num_images: '1'
                image_size: square_hd
                negative_prompt: ''
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
                  taskId: task_ideogram_1765179922911
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
      x-apidog-folder: docs/zh-CN/Market/Image    Models/Ideogram
      x-apidog-status: released
      x-run-in-apidog: https://app.apidog.com/web/project/1184766/apis/api-28506652-run
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
