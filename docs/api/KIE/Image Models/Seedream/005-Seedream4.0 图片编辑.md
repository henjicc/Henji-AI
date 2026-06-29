# Seedream4.0 图片编辑

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
      summary: Seedream4.0 图片编辑
      deprecated: false
      description: >-
        基于 Seedream4.0 实现的图像编辑功能


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
      operationId: bytedance-seedream-v4-edit
      tags:
        - docs/zh-CN/Market/Image    Models/Seedream
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
                    - bytedance/seedream-v4-edit
                  default: bytedance/seedream-v4-edit
                  description: |-
                    用于生成任务的模型名称。必填字段。

                    - 该端点必须使用 `bytedance/seedream-v4-edit` 模型
                  examples:
                    - bytedance/seedream-v4-edit
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
                      description: 用于图像编辑的文本提示词（最大长度：5000 字符）
                      type: string
                      maxLength: 5000
                      examples:
                        - >-
                          参考此标志，为名为‘KIE
                          AI’的户外运动品牌创作一张视觉展示图。在同一张图中呈现五件品牌周边产品：一个包装袋、一顶帽子、一个纸箱、一个腕带和一条挂绳。主视觉色调为蓝色，风格活泼简约且兼具现代感。
                    image_urls:
                      description: >-
                        用于编辑的输入图像 URL 列表。目前最多支持传入 10 张图像。（为上传后的文件
                        URL，而非文件内容；支持类型：image/jpeg、image/png、image/webp；最大大小：10.0MB）
                      type: array
                      items:
                        type: string
                        format: uri
                      maxItems: 10
                      examples:
                        - - >-
                            https://file.aiquickdraw.com/custom-page/akr/section-images/1757930552966e7f2on7s.png
                    image_size:
                      description: 生成图像的尺寸规格
                      type: string
                      enum:
                        - square
                        - square_hd
                        - portrait_4_3
                        - portrait_3_2
                        - portrait_16_9
                        - landscape_4_3
                        - landscape_3_2
                        - landscape_16_9
                        - landscape_21_9
                      default: square_hd
                      examples:
                        - square_hd
                    image_resolution:
                      description: >-
                        最终图像分辨率由 `image_size`（宽高比）和
                        `image_resolution`（像素尺度）共同决定。例如，选择 4:3 比例 + 4K 分辨率，将得到
                        4096 × 3072 像素的图像
                      type: string
                      enum:
                        - 1K
                        - 2K
                        - 4K
                      default: 1K
                      examples:
                        - 1K
                    max_images:
                      description: >-
                        设置单次生成任务可产出的图像数量上限（取值范围
                        1–6）。由于这些图像是一次性生成而非分批次请求，你需要在提示词中明确说明所需图像数量，确保与该参数设置保持一致。（最小值：1，最大值：6，步长：1）
                      type: number
                      minimum: 1
                      maximum: 6
                      default: 1
                      examples:
                        - 1
                    seed:
                      description: 用于控制图像生成随机性的随机种子
                      type: integer
                    nsfw_checker:
                      type: boolean
                      description: >-
                        默认值为 false。您可以根据需要将其设置为 false。如果设置为
                        false，内容过滤功能将被禁用，所有结果将由模型直接返回。
                  required:
                    - prompt
                    - image_urls
                  x-apidog-orders:
                    - prompt
                    - image_urls
                    - image_size
                    - image_resolution
                    - max_images
                    - seed
                    - nsfw_checker
                  x-apidog-ignore-properties: []
              x-apidog-orders:
                - model
                - callBackUrl
                - input
              x-apidog-ignore-properties: []
            example:
              model: bytedance/seedream-v4-edit
              callBackUrl: https://your-domain.com/api/callback
              input:
                prompt: >-
                  参考此标志，为名为‘KIE
                  AI’的户外运动品牌创作一张视觉展示图。在同一张图中呈现五件品牌周边产品：一个包装袋、一顶帽子、一个纸箱、一个腕带和一条挂绳。主视觉色调为蓝色，风格活泼简约且兼具现代感。
                image_urls:
                  - >-
                    https://file.aiquickdraw.com/custom-page/akr/section-images/1757930552966e7f2on7s.png
                image_size: square_hd
                image_resolution: 1K
                max_images: 1
                seed: 77937756
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
                  taskId: task_bytedance_1765176680149
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
      x-apidog-folder: docs/zh-CN/Market/Image    Models/Seedream
      x-apidog-status: released
      x-run-in-apidog: https://app.apidog.com/web/project/1184766/apis/api-28506627-run
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
