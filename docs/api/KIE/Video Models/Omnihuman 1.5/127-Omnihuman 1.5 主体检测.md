# Omnihuman 1.5 主体检测

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
      summary: Omnihuman 1.5 主体检测
      deprecated: false
      description: >-
        ## 创建任务


        调用该接口可创建一个新的主体检测任务。上传一张肖像图片，模型将检测图片中的主体，最多支持 5 个主体。


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
      operationId: omnihuman-1-5-subject-detection
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
                    - omnihuman-1-5/subject-detection
                  default: omnihuman-1-5/subject-detection
                  description: |-
                    用于主体检测的模型名称。必填字段。

                    - 该端点必须使用 `omnihuman-1-5/subject-detection` 模型
                  examples:
                    - omnihuman-1-5/subject-detection
                input:
                  type: object
                  description: 主体检测任务的输入参数。
                  required:
                    - image_url
                  properties:
                    image_url:
                      type: string
                      format: uri
                      description: >-
                        肖像图片 URL。支持检测图片中最多 5
                        个主体。支持的文件类型：image/jpeg、image/png、image/jpg。最大文件大小：5MB。
                  x-apidog-orders:
                    - image_url
                callBackUrl:
                  type: string
                  format: uri
                  description: 回调 URL。任务完成后，kie 会将结果发送到该业务回调地址。
              x-apidog-orders:
                - model
                - input
                - callBackUrl
            example:
              model: omnihuman-1-5/subject-detection
              input:
                image_url: https://your-domain.com/image/portrait.png
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
                              - task_omnihuman-1-5-subject-detection_1234567890
                        x-apidog-orders:
                          - taskId
                    x-apidog-orders:
                      - data
              example:
                code: 200
                msg: success
                data:
                  taskId: task_omnihuman-1-5-subject-detection_1234567890
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
      x-run-in-apidog: https://app.apidog.com/web/project/1184766/apis/api-37876745-run
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
