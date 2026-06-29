# Ideogram V3 图像编辑

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
      summary: Ideogram V3 图像编辑
      deprecated: false
      description: >
        通过 ideogram/v3-edit 进行生成


        ## 创建任务


        调用该接口可创建一个新的图像编辑生成任务。


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
      operationId: ideogram-v3-edit
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
                    - ideogram/v3-edit
                  default: ideogram/v3-edit
                  description: |-
                    用于生成任务的模型名称。必填字段。

                    - 该端点必须使用 `ideogram/v3-edit` 模型
                  examples:
                    - ideogram/v3-edit
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
                  description: 图像编辑任务的输入参数。
                  required:
                    - prompt
                    - image_url
                    - mask_url
                  properties:
                    prompt:
                      type: string
                      maxLength: 5000
                      description: 用于填充图像蒙版区域的文本提示词（最大长度：5000 字符）。
                      examples:
                        - 一只戴着牛仔帽的狗
                    image_url:
                      type: string
                      format: uri
                      description: |-
                        用于生成的原始图像 URL。需要与蒙版图像尺寸一致。

                        - 请提供上传后文件的 URL，而非文件内容
                        - 支持类型：`image/jpeg`、`image/png`、`image/webp`
                        - 最大文件大小：10.0MB
                      examples:
                        - >-
                          https://file.aiquickdraw.com/custom-page/akr/section-images/1755076859801ryyol1du.webp
                    mask_url:
                      type: string
                      format: uri
                      description: |-
                        用于图像修复的蒙版 URL。需要与输入图像尺寸一致。

                        - 请提供上传后文件的 URL，而非文件内容
                        - 支持类型：`image/jpeg`、`image/png`、`image/webp`
                        - 最大文件大小：10.0MB
                      examples:
                        - >-
                          https://file.aiquickdraw.com/custom-page/akr/section-images/1755076871089hx9uonhc.webp
                    rendering_speed:
                      type: string
                      enum:
                        - TURBO
                        - BALANCED
                        - QUALITY
                      default: BALANCED
                      description: |-
                        生成时使用的渲染速度。默认值：`BALANCED`。

                        - `TURBO`: 极速
                        - `BALANCED`: 均衡
                        - `QUALITY`: 高质量
                      examples:
                        - BALANCED
                    expand_prompt:
                      type: boolean
                      default: true
                      description: |-
                        是否在生成请求中启用 MagicPrompt。默认值：`true`。

                        - 布尔值：`true` / `false`
                      examples:
                        - true
                    seed:
                      type: integer
                      description: 随机数生成器的种子值。
                  x-apidog-orders:
                    - prompt
                    - image_url
                    - mask_url
                    - rendering_speed
                    - expand_prompt
                    - seed
                  x-apidog-ignore-properties: []
              x-apidog-orders:
                - model
                - callBackUrl
                - input
              x-apidog-ignore-properties: []
            example:
              model: ideogram/v3-edit
              callBackUrl: https://your-domain.com/api/callback
              input:
                prompt: 一只戴着牛仔帽的狗
                image_url: >-
                  https://file.aiquickdraw.com/custom-page/akr/section-images/1755076859801ryyol1du.webp
                mask_url: >-
                  https://file.aiquickdraw.com/custom-page/akr/section-images/1755076871089hx9uonhc.webp
                rendering_speed: BALANCED
                expand_prompt: true
                seed: 123456
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
      x-run-in-apidog: https://app.apidog.com/web/project/1184766/apis/api-31158270-run
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
