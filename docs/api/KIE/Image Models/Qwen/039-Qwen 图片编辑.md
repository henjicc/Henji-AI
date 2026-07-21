# Qwen 图片编辑

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
      summary: Qwen 图片编辑
      deprecated: false
      description: >-
        基于 qwen/image-edit 模型实现图像生成


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
      operationId: qwen-image-edit
      tags:
        - docs/zh-CN/Market/Image    Models/Qwen
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
                    - qwen/image-edit
                  default: qwen/image-edit
                  description: |-
                    用于生成任务的模型名称。必填字段。

                    - 该端点必须使用 `qwen/image-edit` 模型
                  examples:
                    - qwen/image-edit
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
                      description: 用于图像生成的文本提示词（最大长度：2000 字符）
                      type: string
                      maxLength: 2000
                      examples:
                        - ''
                    image_url:
                      description: >-
                        待编辑图像的 URL。（为上传后的文件
                        URL，非文件内容；支持的类型：image/jpeg、image/png、image/webp；最大文件大小：10.0MB）
                      type: string
                      examples:
                        - >-
                          https://file.aiquickdraw.com/custom-page/akr/section-images/1755603225969i6j87xnw.jpg
                    acceleration:
                      description: >-
                        图像生成的加速级别。可选值：'none'（无加速）、'regular'（常规加速）。加速级别越高，生成速度越快。'regular'
                        模式在速度与画质间取得平衡。默认值："none"
                      type: string
                      enum:
                        - none
                        - regular
                        - high
                      default: none
                      examples:
                        - none
                    image_size:
                      description: 生成图像的尺寸规格。默认值：landscape_4_3
                      type: string
                      enum:
                        - square
                        - square_hd
                        - portrait_4_3
                        - portrait_16_9
                        - landscape_4_3
                        - landscape_16_9
                      default: landscape_4_3
                      examples:
                        - landscape_4_3
                    num_inference_steps:
                      description: 推理步数。默认值：30（最小值：2，最大值：49，步长：1）
                      type: number
                      minimum: 2
                      maximum: 49
                      default: 25
                      examples:
                        - 25
                    seed:
                      description: 随机种子值。相同的种子值、提示词和模型版本，每次生成的图像结果完全一致。
                      type: integer
                    guidance_scale:
                      description: >-
                        CFG（无分类器引导）系数，用于控制模型生成图像时贴合提示词的程度。默认值：4（最小值：0，最大值：20，步长：0.1）
                      type: number
                      minimum: 0
                      maximum: 20
                      default: 4
                      examples:
                        - 4
                    sync_mode:
                      description: >-
                        同步模式。若设置为
                        true，接口会等待图像生成并上传完成后再返回响应。该模式会增加接口延迟，但可直接在响应中获取图像（无需通过
                        CDN）。（布尔值：true/false）
                      type: boolean
                      examples:
                        - false
                    num_images:
                      description: 生成图像数量
                      type: string
                      enum:
                        - '1'
                        - '2'
                        - '3'
                        - '4'
                    enable_safety_checker:
                      description: 安全校验开关。若设置为 true，将启用内容安全校验。默认值：true（布尔值：true/false）
                      type: boolean
                      examples:
                        - true
                    output_format:
                      description: 生成图像的输出格式。默认值："png"
                      type: string
                      enum:
                        - jpeg
                        - png
                      default: png
                      examples:
                        - png
                    negative_prompt:
                      description: 反向提示词，用于规避生成指定内容。默认值：" "（最大长度：500 字符）
                      type: string
                      maxLength: 500
                      examples:
                        - 模糊、丑陋
                    nsfw_checker:
                      type: boolean
                      default: false
                      description: >-
                        默认值为 false。您可以根据需要将其设置为 false。如果设置为
                        false，我们的内容过滤功能将被禁用，所有结果将由模型直接返回。
                  required:
                    - prompt
                    - image_url
                  x-apidog-orders:
                    - prompt
                    - image_url
                    - acceleration
                    - image_size
                    - num_inference_steps
                    - seed
                    - guidance_scale
                    - sync_mode
                    - num_images
                    - enable_safety_checker
                    - output_format
                    - negative_prompt
                    - nsfw_checker
                  x-apidog-ignore-properties: []
              x-apidog-orders:
                - model
                - callBackUrl
                - input
              x-apidog-ignore-properties: []
            example:
              model: qwen/image-edit
              callBackUrl: https://your-domain.com/api/callback
              input:
                prompt: ''
                image_url: >-
                  https://file.aiquickdraw.com/custom-page/akr/section-images/1755603225969i6j87xnw.jpg
                acceleration: none
                image_size: landscape_4_3
                num_inference_steps: 25
                guidance_scale: 4
                sync_mode: false
                enable_safety_checker: true
                output_format: png
                negative_prompt: 模糊、丑陋
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
                  taskId: task_qwen_1765179676651
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
      x-apidog-folder: docs/zh-CN/Market/Image    Models/Qwen
      x-apidog-status: released
      x-run-in-apidog: https://app.apidog.com/web/project/1184766/apis/api-28506655-run
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
