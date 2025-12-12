# Web Search API

从全网搜索任何网页信息和网页链接，结果准确、摘要完整，更适合 AI 使用。
搜索结果包括网页、图片

*   网页包括 name、url、snippet、summary、siteName、siteIcon、datePublished 等信息
*   图片包括 contentUrl、hostPageUrl、width、height 等信息

可配置搜索时间范围、是否显示摘要，支持按分页获取更多结果。

## 请求示例

**端点**
```
POST https://api.ppinfra.com/v3/web-search
```

**cURL 示例**
```bash
curl --request POST \
  --url https://api.ppinfra.com/v3/web-search \
  --header 'Authorization: <authorization>' \
  --header 'Content-Type: <content-type>' \
  --data '
{
  "query": "<string>",
  "freshness": "<string>",
  "summary": true,
  "include": "<string>",
  "exclude": "<string>",
  "count": 123
}
'
```

## 请求头

| 参数名 | 类型 | 是否必需 | 描述 |
| :--- | :--- | :--- | :--- |
| `Content-Type` | string | 是 | 枚举值: `application/json` |
| `Authorization` | string | 是 | Bearer 身份验证格式，例如：`Bearer {{API 密钥}}`。 |

## 请求体

| 参数名 | 类型 | 是否必需 | 描述 |
| :--- | :--- | :--- | :--- |
| `query` | string | 是 | 用户的搜索词。 |
| `freshness` | string | 否 | 搜索指定时间范围内的网页。可填值：<br/>• `noLimit`，不限（默认）<br/>• `oneDay`，一天内<br/>• `oneWeek`，一周内<br/>• `oneMonth`，一个月内<br/>• `oneYear`，一年内<br/>• `YYYY-MM-DD..YYYY-MM-DD`，搜索日期范围，例如：“2025-01-01..2025-04-06”<br/>• `YYYY-MM-DD`，搜索指定日期，例如：“2025-04-06”<br/><br/>推荐使用 `noLimit`。搜索算法会自动进行时间范围的改写，效果更佳。如果指定时间范围，很有可能出现时间范围内没有相关网页的情况，导致找不到搜索结果。 |
| `summary` | boolean | 否 | 是否显示文本摘要。可填值：<br/>• `true`，显示<br/>• `false`，不显示（默认） |
| `include` | string | 否 | 指定搜索的网站范围。多个域名使用 `|` 或 `,` 分隔，最多不能超过20个可填值：<br/>• 根域名<br/>• 子域名<br/><br/>例如：`qq.com|m.163.com` |
| `exclude` | string | 否 | 排除搜索的网站范围。多个域名使用 `|` 或 `,` 分隔，最多不能超过20个可填值：<br/>• 根域名<br/>• 子域名<br/><br/>例如：`qq.com|m.163.com` |
| `count` | int | 否 | 返回结果的条数（实际返回结果数量可能会小于count指定的数量）。<br/>• 可填范围：1-50，最大单次搜索返回50条<br/>• 默认为10 |

## 响应

### 响应示例
```json
{
  "SearchData": {
    "_type": "<string>",
    "queryContext": {},
    "webPages": {},
    "images": {},
    "videos": {}
  },
  "WebSearchQueryContext": {
    "originalQuery": "<string>"
  },
  "WebSearchWebPages": {
    "webSearchUrl": "<string>",
    "totalEstimatedMatches": 123,
    "value": [
      {}
    ],
    "someResultsRemoved": true
  },
  "WebPageValue": {
    "id": "<string>",
    "name": "<string>",
    "url": "<string>",
    "displayUrl": "<string>",
    "snippet": "<string>",
    "summary": "<string>",
    "siteName": "<string>",
    "siteIcon": "<string>",
    "datePublished": "<string>",
    "dateLastCrawled": "<string>",
    "cachedPageUrl": "<string>",
    "language": "<string>",
    "isFamilyFriendly": true,
    "isNavigational": true
  },
  "WebSearchImages": {
    "id": "<string>",
    "readLink": "<string>",
    "webSearchUrl": "<string>",
    "isFamilyFriendly": true,
    "value": [
      {}
    ]
  },
  "WebSearchVideos": {
    "id": "<string>",
    "readLink": "<string>",
    "webSearchUrl": "<string>",
    "isFamilyFriendly": true,
    "scenario": "<string>",
    "value": [
      {}
    ]
  },
  "ImageValue": {
    "webSearchUrl": "<string>",
    "name": "<string>",
    "thumbnailUrl": "<string>",
    "datePublished": "<string>",
    "contentUrl": "<string>",
    "hostPageUrl": "<string>",
    "contentSize": "<string>",
    "encodingFormat": "<string>",
    "hostPageDisplayUrl": "<string>",
    "width": 123,
    "height": 123,
    "thumbnail": {}
  },
  "VideoValue": {
    "webSearchUrl": "<string>",
    "name": "<string>",
    "description": "<string>",
    "thumbnailUrl": "<string>",
    "publisher": [
      {}
    ],
    "creator": {},
    "contentUrl": "<string>",
    "hostPageUrl": "<string>",
    "encodingFormat": "<string>",
    "hostPageDisplayUrl": "<string>",
    "width": 123,
    "height": 123,
    "duration": "<string>",
    "motionThumbnailUrl": "<string>",
    "embedHtml": "<string>",
    "allowHttpsEmbed": true,
    "viewCount": 123,
    "thumbnail": {},
    "allowMobileEmbed": true,
    "isSuperfresh": true,
    "datePublished": "<string>"
  },
  "Creator": {
    "name": "<string>"
  },
  "Publisher": {
    "name": "<string>"
  },
  "Thumbnail": {
    "height": 123,
    "width": 123
  },
  "RankingResponse": {
    "mainline": {}
  },
  "Mainline": {
    "items": [
      {}
    ]
  },
  "MainlineItem": {
    "answerType": "<string>",
    "value": {}
  },
  "MainlineItemValue": {
    "id": "<string>"
  }
}
```

### 响应参数说明

#### SearchData
搜索响应的主要数据对象。

| 参数名 | 类型 | 描述 |
| :--- | :--- | :--- |
| `_type` | string | 搜索的类型，固定值为 `SearchResponse` |
| `queryContext` | WebSearchQueryContext | 搜索查询的上下文信息 |
| `webPages` | WebSearchWebPages | 搜索的网页结果 |
| `images` | WebSearchImages | 搜索的图片结果 |
| `videos` | WebSearchVideos | 搜索的视频结果 |

#### WebSearchQueryContext
搜索查询的上下文信息。

| 参数名 | 类型 | 描述 |
| :--- | :--- | :--- |
| `originalQuery` | string | 原始的搜索关键字 |

#### WebSearchWebPages
搜索的网页结果集合。

| 参数名 | 类型 | 描述 |
| :--- | :--- | :--- |
| `webSearchUrl` | string | 搜索结果的URL |
| `totalEstimatedMatches` | int | 搜索匹配的网页总数 |
| `value` | List\<WebPageValue\> | 网页搜索结果列表 |
| `someResultsRemoved` | boolean | 结果中是否有被安全过滤的内容 |

#### WebPageValue
单个网页搜索结果的详细信息。

| 参数名 | 类型 | 描述 |
| :--- | :--- | :--- |
| `id` | string | 网页的排序ID |
| `name` | string | 网页的标题 |
| `url` | string | 网页的URL |
| `displayUrl` | string | 网页的展示URL（url decode后的格式） |
| `snippet` | string | 网页内容的简短描述 |
| `summary` | string | 网页内容的文本摘要，当请求参数中 `summary` 为 `true` 时显示此属性 |
| `siteName` | string | 网页的网站名称 |
| `siteIcon` | string | 网页的网站图标 |
| `datePublished` | string | 网页的发布时间（例如：`2025-02-23T08:18:30+08:00`），UTC+8时间 |
| `dateLastCrawled` | string | **注意**：接口中返回的 `dateLastCrawled` 值（例如：`2025-02-23T08:18:30Z`）实际上要表达的是 UTC+8 北京时间 `2025-02-23 08:18:30`，并非UTC时间。实际应用中请使用 `datePublished` 字段，或将 `2025-02-23T08:18:30Z` 替换成 `2025-02-23T08:18:30+08:00`，即得到正确的UTC+8时间，可以使用 datetime 函数正确解析。 |
| `cachedPageUrl` | string | 网页的缓存页面URL |
| `language` | string | 网页的语言 |
| `isFamilyFriendly` | boolean | 是否为家庭友好的页面 |
| `isNavigational` | boolean | 是否为导航性页面 |

#### WebSearchImages
搜索的图片结果集合。

| 参数名 | 类型 | 描述 |
| :--- | :--- | :--- |
| `id` | string | 图片搜索结果的ID |
| `readLink` | string | 图片的读取链接 |
| `webSearchUrl` | string | 图片搜索结果的URL |
| `isFamilyFriendly` | boolean | 是否为家庭友好的图片 |
| `value` | List\<ImageValue\> | 图片搜索结果列表 |

#### WebSearchVideos
搜索的视频结果集合。

| 参数名 | 类型 | 描述 |
| :--- | :--- | :--- |
| `id` | string | 视频搜索结果的ID |
| `readLink` | string | 视频的读取链接 |
| `webSearchUrl` | string | 视频搜索结果的URL |
| `isFamilyFriendly` | boolean | 是否为家庭友好的视频 |
| `scenario` | string | 视频的场景描述 |
| `value` | List\<VideoValue\> | 视频搜索结果列表 |

#### ImageValue
单个图片搜索结果的详细信息。

| 参数名 | 类型 | 描述 |
| :--- | :--- | :--- |
| `webSearchUrl` | string | 图片的搜索URL |
| `name` | string | 图片的名称 |
| `thumbnailUrl` | string | 图片的缩略图URL |
| `datePublished` | string | 图片的发布时间 |
| `contentUrl` | string | 图片的内容URL |
| `hostPageUrl` | string | 图片所在页面的URL |
| `contentSize` | string | 图片的文件大小 |
| `encodingFormat` | string | 图片的编码格式 |
| `hostPageDisplayUrl` | string | 图片所在页面的展示URL |
| `width` | int | 图片的宽度 |
| `height` | int | 图片的高度 |
| `thumbnail` | Thumbnail | 图片的缩略图信息 |

#### VideoValue
单个视频搜索结果的详细信息。

| 参数名 | 类型 | 描述 |
| :--- | :--- | :--- |
| `webSearchUrl` | string | 视频的搜索URL |
| `name` | string | 视频的名称 |
| `description` | string | 视频的描述 |
| `thumbnailUrl` | string | 视频的缩略图URL |
| `publisher` | List\<Publisher\> | 视频的发布者列表 |
| `creator` | Creator | 视频的创建者信息 |
| `contentUrl` | string | 视频的内容URL |
| `hostPageUrl` | string | 视频所在页面的URL |
| `encodingFormat` | string | 视频的编码格式 |
| `hostPageDisplayUrl` | string | 视频所在页面的展示URL |
| `width` | int | 视频的宽度 |
| `height` | int | 视频的高度 |
| `duration` | string | 视频的时长 |
| `motionThumbnailUrl` | string | 视频的动态缩略图URL |
| `embedHtml` | string | 视频的嵌入HTML代码 |
| `allowHttpsEmbed` | boolean | 是否允许HTTPS嵌入 |
| `viewCount` | int | 视频的观看次数 |
| `thumbnail` | Thumbnail | 视频的缩略图信息 |
| `allowMobileEmbed` | boolean | 是否允许移动端嵌入 |
| `isSuperfresh` | boolean | 是否为超新鲜内容 |
| `datePublished` | string | 视频的发布时间 |

#### Creator
创建者信息。

| 参数名 | 类型 | 描述 |
| :--- | :--- | :--- |
| `name` | string | 创建者的名称 |

#### Publisher
发布者信息。

| 参数名 | 类型 | 描述 |
| :--- | :--- | :--- |
| `name` | string | 发布者的名称 |

#### Thumbnail
缩略图信息。

| 参数名 | 类型 | 描述 |
| :--- | :--- | :--- |
| `height` | int | 缩略图的高度 |
| `width` | int | 缩略图的宽度 |

#### RankingResponse
排名响应信息。

| 参数名 | 类型 | 描述 |
| :--- | :--- | :--- |
| `mainline` | Mainline | 主线排名信息 |

#### Mainline
主线排名信息。

| 参数名 | 类型 | 描述 |
| :--- | :--- | :--- |
| `items` | List\<MainlineItem\> | 主线项目列表 |

#### MainlineItem
主线项目信息。

| 参数名 | 类型 | 描述 |
| :--- | :--- | :--- |
| `answerType` | string | 答案类型 |
| `value` | MainlineItemValue | 主线项目的值 |

#### MainlineItemValue
主线项目值信息。

| 参数名 | 类型 | 描述 |
| :--- | :--- | :--- |
| `id` | string | 主线项目值的ID |