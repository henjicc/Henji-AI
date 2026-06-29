# 生成 Persona

## OpenAPI Specification

```yaml
openapi: 3.0.1
info:
  title: ''
  description: ''
  version: 1.0.0
paths:
  /api/v1/generate/generate-persona:
    post:
      summary: 生成 Persona
      deprecated: false
      description: >-
        > 基于已生成的音乐创建个性化的音乐 Persona，为音乐赋予独特的身份和特征。


        ## 使用指南


        * 此接口用于为已生成的音乐创建 Persona（音乐角色）

        * 需要提供来自音乐生成相关接口（生成、扩展）的 `taskId` 和音频 ID

        * 可以自定义 Persona 的名称和描述，为音乐赋予独特的个性

        * 生成的 Persona 可用于后续的音乐创作和风格迁移


        ## 参数详情


        | 参数名 | 类型 | 是否必需 | 说明 |

        | :--- | :--- | :--- | :--- |

        | `taskId` | `string` | 必需 | 指定原始音乐生成任务的唯一标识符。可以是以下接口返回的 `taskId`：<br/>•
        [生成音乐](/cn/suno-api/generate-music) (`/api/v1/generate`)<br/>•
        [扩展音乐](/cn/suno-api/extend-music) (`/api/v1/generate/extend`) |

        | `audioId` | `string` | 必需 | 指定要创建 Persona 的音频 ID |

        | `name` | `string` | 必需 | 为 Persona 指定一个易于识别的名称 |

        | `description` | `string` | 必需 | 描述 Persona 的音乐特征、风格和个性 |


        ## 开发者注意事项


        :::caution 重要提示

        调用此接口前请确保音乐生成任务已完全完成。如果音乐正在生成中时调用此接口将会返回失败。

        :::


        * **模型要求**：Persona 生成仅支持使用 **v3_5 以上版本** 模型生成的音乐的 `taskId`（v3_5 本身不支持）。

        * 建议为 Persona 提供详细的描述，以便更好地捕捉音乐特征。

        * 返回的 `personaId` 可以用于后续的音乐生成请求中，以创作具有相似风格特征的音乐。

        * 你可以将 `personaId` 应用到以下接口：
          * [生成音乐](/cn/suno-api/generate-music)
          * [扩展音乐](/cn/suno-api/extend-music)
        * 每个音频 ID 只能生成一次 Persona。


        ## 参数示例


        ```json

        {
          "taskId": "5c79****be8e",
          "audioId": "e231****-****-****-****-****8cadc7dc",
          "name": "电子流行歌手",
          "description": "具有现代电子音乐风格的流行歌手，擅长动感节奏和合成器音色"
        }

        ```


        :::note[]

        确保使用的 `taskId` 对应的音乐生成任务已完成，且 `audioId` 在有效范围内。

        :::


        :::tip[]

        为 Persona 提供详细而具体的描述可以帮助系统更准确地捕捉音乐风格特征。

        :::
      operationId: generate-persona
      tags:
        - docs/zh-CN/Market/Suno API/Music Generation
      parameters: []
      requestBody:
        content:
          application/json:
            schema:
              type: object
              required:
                - taskId
                - audioId
                - name
                - description
              properties:
                taskId:
                  type: string
                  description: |-
                    原始音乐生成任务的唯一标识符。可以是以下任一接口返回的 taskId：
                    - 生成音乐 (/api/v1/generate)
                    - 扩展音乐 (/api/v1/generate/extend)
                  examples:
                    - 5c79****be8e
                audioId:
                  type: string
                  description: 要创建 Persona 的音频曲目的唯一标识符。此ID在音乐生成完成后的回调数据中返回。
                  examples:
                    - e231****-****-****-****-****8cadc7dc
                name:
                  type: string
                  description: Persona 的名称。一个能够捕捉音乐风格或角色本质的描述性名称。
                  examples:
                    - 电子流行歌手
                description:
                  type: string
                  description: Persona 的音乐特征、风格和个性的详细描述。请具体说明流派、情绪、乐器使用和人声特质。
                  examples:
                    - 具有现代电子音乐风格的流行歌手，擅长动感节奏和合成器音色
              x-apidog-orders:
                - taskId
                - audioId
                - name
                - description
              x-apidog-ignore-properties: []
            example:
              taskId: 2fac****9f72
              audioId: e231****-****-****-****-****8cadc7dc
              prompt: A calm and relaxing piano track.
              tags: Jazz
              title: Relaxing Piano
              negativeTags: Rock
              infillStartS: 10.5
              infillEndS: 20.75
              fullLyrics: |-
                [Verse 1]
                Original lyrics here
                [Chorus]
                Modified lyrics for this section
                [Verse 2]
                More original lyrics
              callBackUrl: https://example.com/callback
      responses:
        '200':
          description: 请求成功
          content:
            application/json:
              schema:
                allOf:
                  - type: object
                    properties:
                      code:
                        type: integer
                        enum:
                          - 200
                          - 401
                          - 402
                          - 404
                          - 409
                          - 422
                          - 429
                          - 451
                          - 455
                          - 500
                        description: |-
                          响应状态码

                          - **200**: 成功 - 请求已成功处理
                          - **401**: 未授权 - 身份验证凭据缺失或无效
                          - **402**: 积分不足 - 账户没有足够的积分执行此操作
                          - **404**: 未找到 - 请求的资源或端点不存在
                          - **409**: 冲突 - 该音乐的 Persona 已存在
                          - **422**: 验证错误 - 请求参数未通过验证检查
                          - **429**: 超出限制 - 已超过对此资源的请求限制
                          - **451**: 未授权 - 获取音乐数据失败。请验证您或您的服务提供商设置的任何访问限制。
                          - **455**: 服务不可用 - 系统当前正在进行维护
                          - **500**: 服务器错误 - 处理请求时发生意外错误
                      msg:
                        type: string
                        description: 当 code != 200 时的错误信息
                        examples:
                          - success
                    x-apidog-orders:
                      - code
                      - msg
                    x-apidog-ignore-properties: []
                  - type: object
                    properties:
                      data:
                        type: object
                        properties:
                          personaId:
                            type: string
                            description: >-
                              生成的 Persona 的唯一标识符。该 personaId
                              可用于后续的音乐生成请求（生成音乐、扩展音乐、上传并翻唱音频、上传并扩展音频），以创作具有相似风格特征的音乐。
                            examples:
                              - a1b2****c3d4
                          name:
                            type: string
                            description: 请求中提供的 Persona 名称。
                            examples:
                              - 电子流行歌手
                          description:
                            type: string
                            description: 请求中提供的 Persona 的音乐特征、风格和个性的详细描述。
                            examples:
                              - 具有现代电子音乐风格的流行歌手，擅长动感节奏和合成器音色
                        x-apidog-orders:
                          - personaId
                          - name
                          - description
                        x-apidog-ignore-properties: []
                    x-apidog-orders:
                      - data
                    x-apidog-ignore-properties: []
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
      x-apidog-folder: docs/zh-CN/Market/Suno API/Music Generation
      x-apidog-status: released
      x-run-in-apidog: https://app.apidog.com/web/project/1184766/apis/api-28506727-run
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
