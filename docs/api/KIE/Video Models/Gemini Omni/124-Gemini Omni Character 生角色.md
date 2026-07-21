# Gemini Omni Character 生角色

## OpenAPI Specification

```yaml
openapi: 3.0.1
info:
  title: ''
  description: ''
  version: 1.0.0
paths:
  /api/v1/omni/character/create:
    post:
      summary: Gemini Omni Character 生角色
      deprecated: false
      description: |-
        - `image_urls` 仅支持上传 `1` 张图片，单张图片不超过 `20MB`
        - `audio_ids` 需来自 `gemini-omni-audio` 接口

        ## 创建任务

        调用该接口可创建一个新的角色

        ## 相关资源

        <CardGroup cols={2}>
          <Card title="模型市场" icon="lucide-store" href="/market/quickstart">
            浏览全部可用模型与能力
          </Card>
          <Card title="通用 API" icon="lucide-cog" href="/common-api/get-account-credits">
            查看账户积分与调用情况
          </Card>
        </CardGroup>
      operationId: gemini-omni-character-zh
      tags:
        - docs/zh-CN/Market/Video Models/Gemini Omni
      parameters: []
      requestBody:
        content:
          application/json:
            schema:
              type: object
              required:
                - descriptions
                - image_urls
              properties:
                descriptions:
                  type: string
                  description: 角色描述，用于说明角色的外观、身份、风格、服饰或性格设定。
                  examples:
                    - 一个银白短发、身穿未来风机能夹克的年轻女性角色，冷静、敏捷，具有赛博朋克气质。
                image_urls:
                  type: array
                  maxItems: 1
                  items:
                    type: string
                    format: uri
                  description: |-
                    角色参考图片地址数组。仅支持传入 `1` 张图片。

                    图片限制：
                    - 单张图片大小不超过 `20MB`
                    - 请使用可公开访问的图片 URL
                  examples:
                    - - https://example.com/assets/character-reference.png
                audio_ids:
                  type: array
                  items:
                    type: string
                  description: 由 `gemini-omni-audio` 接口生成的音频 ID 数组。可用于为角色补充声音特征、语气或人设参考。
                  examples:
                    - - audio_01hx8p0demo
                character_name:
                  type: string
                  description: 角色名称
              x-apidog-orders:
                - descriptions
                - image_urls
                - audio_ids
                - character_name
            example:
              descriptions: 一个银白短发、身穿未来风机能夹克的年轻女性角色，冷静、敏捷，具有赛博朋克气质。
              image_urls:
                - https://example.com/assets/character-reference.png
              audio_ids:
                - audio_01hx8p0demo
              character_name: 珍妮
      responses:
        '200':
          description: 请求成功
          content:
            application/json:
              schema:
                allOf:
                  - type: object
                    properties:
                      data:
                        type: object
                        properties:
                          characterName:
                            type: string
                          imageUrl:
                            type: string
                          characterId:
                            type: string
                        x-apidog-orders:
                          - characterId
                          - characterName
                          - imageUrl
                      msg:
                        type: string
                    x-apidog-orders:
                      - data
                      - msg
              example:
                code: 200
                msg: success
                data:
                  characterId: b09dbf56...
                  characterName: 可爱角色
                  imageUrl: https://xx.com/a.png
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
      x-apidog-folder: docs/zh-CN/Market/Video Models/Gemini Omni
      x-apidog-status: released
      x-run-in-apidog: https://app.apidog.com/web/project/1184766/apis/api-36220462-run
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
