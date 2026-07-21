# Ideogram V3 文生图

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
      summary: Ideogram V3 文生图
      deprecated: false
      description: >
        通过 ideogram/v3-text-to-image 进行生成


        ## 创建任务


        调用该接口可创建一个新的图像生成任务。


        <Card title="查询任务详情" icon="lucide-search"
        href="/market/common/get-task-detail">
          提交任务后，可通过统一查询接口查看任务进度并获取生成结果
        </Card>


        ::: tip[]

        生产环境建议优先使用 `callBackUrl` 参数接收任务完成通知，而不是持续轮询任务状态接口。

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
      operationId: ideogram-v3-text-to-image
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
                - input
              properties:
                model:
                  type: string
                  enum:
                    - ideogram/v3-text-to-image
                  default: ideogram/v3-text-to-image
                  description: |-
                    用于生成任务的模型名称。必填字段。

                    - 该端点必须使用 `ideogram/v3-text-to-image` 模型
                  examples:
                    - ideogram/v3-text-to-image
                callBackUrl:
                  type: string
                  format: uri
                  description: >-
                    接收任务完成通知的回调 URL。可选参数；如果提供，系统会在任务完成（成功或失败）后向该地址发送 POST
                    请求；如未提供，则不会发送回调通知。
                  examples:
                    - https://your-domain.com/api/callback
                input:
                  type: object
                  description: 生成任务的输入参数。
                  required:
                    - prompt
                  properties:
                    prompt:
                      type: string
                      maxLength: 5000
                      description: 要生成图像的描述文本（最大长度：5000 字符）。
                      examples:
                        - >-
                          一张电影感十足的湖畔摄影作品，暮色降临，画面略带俯视角。画面中央，一簇柔和发光的芦苇与睡莲在平静水面上映出金色倒影。优雅的霓虹风白色文字“Kie.ai”悬浮在水面上方，微微发光，与自然光晕和谐融合。四周垂柳与薄雾共同营造出宁静而奇幻的氛围，暖色高光与傍晚天空的冷蓝色形成鲜明对比。
                    rendering_speed:
                      type: string
                      enum:
                        - TURBO
                        - BALANCED
                        - QUALITY
                      description: |-
                        生成时使用的渲染速度。

                        - `TURBO`: 极速
                        - `BALANCED`: 均衡
                        - `QUALITY`: 高质量
                      examples:
                        - BALANCED
                    style:
                      type: string
                      enum:
                        - AUTO
                        - GENERAL
                        - REALISTIC
                        - DESIGN
                      description: |-
                        生成时使用的风格类型，不能与 `style_codes` 同时使用。

                        - `AUTO`: 自动
                        - `GENERAL`: 通用
                        - `REALISTIC`: 写实
                        - `DESIGN`: 设计
                      examples:
                        - AUTO
                    expand_prompt:
                      type: boolean
                      description: |-
                        是否在生成请求中启用 MagicPrompt。

                        - 布尔值：`true` / `false`
                      examples:
                        - true
                    image_size:
                      type: string
                      enum:
                        - square
                        - square_hd
                        - portrait_4_3
                        - portrait_16_9
                        - landscape_4_3
                        - landscape_16_9
                      description: |-
                        生成图像的分辨率。

                        - `square`: 方图
                        - `square_hd`: 高清方图
                        - `portrait_4_3`: 竖图 3:4
                        - `portrait_16_9`: 竖图 9:16
                        - `landscape_4_3`: 横图 4:3
                        - `landscape_16_9`: 横图 16:9
                      examples:
                        - square_hd
                    seed:
                      type: integer
                      description: 随机数生成器的种子值。
                    negative_prompt:
                      type: string
                      maxLength: 5000
                      description: 描述图像中需要排除的内容。若正向提示词与负向提示词冲突，以正向提示词为准。最大长度：5000 字符。
                  x-apidog-orders:
                    - prompt
                    - rendering_speed
                    - style
                    - expand_prompt
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
              model: ideogram/v3-text-to-image
              callBackUrl: https://your-domain.com/api/callback
              input:
                prompt: >-
                  一张电影感十足的湖畔摄影作品，暮色降临，画面略带俯视角。画面中央，一簇柔和发光的芦苇与睡莲在平静水面上映出金色倒影。优雅的霓虹风白色文字“Kie.ai”悬浮在水面上方，微微发光，与自然光晕和谐融合。四周垂柳与薄雾共同营造出宁静而奇幻的氛围，暖色高光与傍晚天空的冷蓝色形成鲜明对比。
                rendering_speed: BALANCED
                style: AUTO
                expand_prompt: true
                image_size: square_hd
                seed: 123456
                negative_prompt: 模糊、低清晰度、畸形、额外的肢体、错位文字、水印
      responses:
        '200':
          description: 请求成功
          content:
            application/json:
              schema:
                allOf:
                  - $ref: '#/components/schemas/ApiResponse'
                  - type: object
                    properties:
                      data:
                        type: object
                        properties:
                          taskId:
                            type: string
                            description: 任务 ID，可用于调用任务详情接口查询任务状态。
                            examples:
                              - task_ideogram_1765180586443
                        x-apidog-orders:
                          - taskId
                        x-apidog-ignore-properties: []
                    x-apidog-orders:
                      - data
                    x-apidog-ignore-properties: []
              example:
                code: 200
                msg: success
                data:
                  taskId: task_ideogram_1765180586443
          headers: {}
          x-apidog-name: ''
        '500':
          description: 请求失败
          content:
            application/json:
              schema:
                type: object
                properties: {}
                x-apidog-orders: []
                x-apidog-ignore-properties: []
          headers: {}
          x-apidog-name: Error
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
      x-run-in-apidog: https://app.apidog.com/web/project/1184766/apis/api-31157301-run
components:
  schemas:
    ApiResponse:
      type: object
      properties:
        code:
          type: integer
          description: >-
            Response status code


            - **200**: Success - Request has been processed successfully

            - **401**: Unauthorized - Authentication credentials are missing or
            invalid

            - **402**: Insufficient Credits - Account does not have enough
            credits to perform the operation

            - **404**: Not Found - The requested resource or endpoint does not
            exist

            - **422**: Validation Error - The request parameters failed
            validation checks

            - **429**: Rate Limited - Request limit has been exceeded for this
            resource

            - **433**: Request Limit - Sub-key Usage Exceeds Limit

            - **455**: Service Unavailable - System is currently undergoing
            maintenance

            - **500**: Server Error - An unexpected error occurred while
            processing the request

            - **501**: Generation Failed - Content generation task failed

            - **505**: Feature Disabled - The requested feature is currently
            disabled
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
          description: Response message, error description when failed
          examples:
            - success
        data:
          type: object
          properties:
            taskId:
              type: string
              description: >-
                Task ID, can be used with Get Task Details endpoint to query
                task status
          x-apidog-orders:
            - taskId
          required:
            - taskId
          x-apidog-ignore-properties: []
      x-apidog-orders:
        - code
        - msg
        - data
      title: response not with recordId
      required:
        - data
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
