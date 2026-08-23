# SEO 小游戏站设计规格

**状态：** 已批准进入实施  
**日期：** 2026-08-19  
**工作名称：** GameSite  
**目标规模：** 首批 10–50 个精选小游戏，架构可平滑扩展到约 1000 个页面  
**核心目标：** 让所有希望参与搜索排名的页面在首次返回的 HTML 中直接包含完整、唯一、可理解的内容，同时将游戏运行代码与 SEO 主站独立部署。

---

## 1. 项目目标

构建一个面向海外搜索流量的 HTML5 小游戏站。站点以游戏详情页和分类页承接自然搜索流量，游戏本体通过 iframe 加载。

最终访问关系：

```text
https://www.example.com/games/going-balls/
                          │
                          └── iframe
                              https://play.example.com/going-balls/index.html
```

主站负责：

- 首页、游戏列表页、游戏详情页、分类页；
- SEO 文案、标题、描述、Canonical、结构化数据；
- 内部链接、相关推荐、Sitemap、Robots；
- 广告位容器；
- 游戏封面、截图和可读内容。

游戏运行域负责：

- 游戏 HTML、JavaScript、CSS、图片、音频；
- 游戏版本和缓存；
- 与主站独立发布；
- 不承担游戏详情页的 SEO 主体内容。

---

## 2. 明确不做的内容

首版不实现以下功能：

- 用户注册、登录和账号体系；
- 收藏云同步、评论、评分和排行榜；
- 数据库、Redis、D1、Supabase；
- 运行时 SSR、Next.js ISR、服务端 API；
- 个性化推荐；
- 多语言；
- 自动抓取第三方发行平台；
- 在线上传并解压游戏 ZIP；
- 实时游戏次数；
- 具体广告平台脚本；
- 游戏开发工具链；
- 大规模程序化生成低质量页面。

这些功能只有在真实流量和 GSC 信号证明需要后再立项。

---

## 3. 技术选择

### 3.1 主站

- Astro v7；
- 默认静态输出，禁止配置 `output: "server"`；
- TypeScript strict；
- Astro Content Collections；
- Markdown 游戏内容；
- 无 React、Vue、Svelte 等客户端框架；
- npm 和 `package-lock.json`；
- Node.js 24 LTS；
- 部署到 Cloudflare Workers Static Assets；
- 不安装 Astro Cloudflare SSR Adapter。

### 3.2 管理后台

- Decap CMS；
- 独立静态应用目录 `apps/cms-admin/`；
- 生产地址使用专用 Origin，例如 `https://cms.example.com/`；
- 禁止使用公开站点的 `/admin/` pathname 作为生产后台；
- 内容直接写入 GitHub 仓库；
- Git 提交触发重新构建；
- 本地使用 Decap local backend；
- 本地 Admin 地址为 `http://127.0.0.1:4322/`；
- 生产使用独立 Cloudflare Worker GitHub OAuth Proxy；
- OAuth 密钥仅保存为 Cloudflare Secret，禁止写入仓库。

Decap 3.15.1 会把包含 GitHub token 的认证用户对象保存在按 Origin 隔离的 `localStorage` 中；浏览器存储不按 pathname 隔离。因此 CMS Admin 必须始终使用独立 Origin，且不得加载公开站点的广告或 analytics。

### 3.3 游戏资源

- Cloudflare R2；
- 正式访问域名 `play.example.com`；
- 生产环境禁止使用 `r2.dev`；
- R2 通过自定义域名接入 Cloudflare Cache；
- 批量上传优先使用 rclone 或 S3 兼容工具；
- 主站只保存绝对 HTTPS `embedUrl`，不保存游戏代码。

### 3.4 采用 Astro minimal，而不是直接 fork 第三方完整模板

CodeStitch 的 Astro + Decap 模板可作为参考，但不作为正式代码底座。原因是它同时带有商业站 Demo、LocalBusiness Schema、Netlify/DecapBridge 配置、LESS、View Transitions 和 Google Fonts。直接 fork 后再删除会留下较多无关逻辑。

正式项目从 Astro minimal 初始化，只添加本项目明确需要的能力。这样可以降低 Codex 后续维护时的理解成本和技术债。

---

## 4. 架构原则

### 4.1 首次 HTML 完整

任何可索引页面必须满足：

- `view-source:` 中直接存在唯一 `<title>`；
- 直接存在 meta description；
- 直接存在 Canonical；
- 直接存在 H1；
- 直接存在游戏介绍、操作说明、分类和相关推荐；
- 直接存在 JSON-LD；
- 主体内容不依赖客户端 `fetch()`、`useEffect` 或浏览器 JavaScript。

客户端 JavaScript只允许用于：

- 移动端菜单；
- 点击 Play 后加载 iframe；
- 全屏按钮；
- 非 SEO 必需的小型交互。

### 4.2 游戏代码隔离

- `src/` 和 `public/` 中不得保存完整游戏构建文件；
- 主站仓库不得出现 `public/games/<slug>/index.html` 一类游戏包；
- 每条游戏数据只保存 `embedUrl`；
- 允许本地测试使用一个极小的 iframe fixture，但不得被生产页面引用；
- 游戏域名必须处于允许列表中。

### 4.3 静态优先

- Astro 保持默认静态模式；
- 所有游戏页和分类页使用 `getStaticPaths()`；
- `wrangler.jsonc` 只配置 `assets.directory`，不配置 `main`；
- 不增加 Worker 请求处理代码；
- 不增加数据库绑定；
- Cloudflare 请求直接命中静态文件。

### 4.4 小批量高质量发布

架构允许管理大量游戏，但首批仅发布 10–50 个真正满足搜索意图的页面。每个游戏页必须有真实差异，不得仅替换游戏名和 iframe。

---

## 5. 页面和路由

必须提供以下路由：

```text
/
 /games/
 /games/[game-id]/
 /category/[category-id]/
 /about/
 /privacy/
 /terms/
 /404.html
 /robots.txt
 /sitemap-index.xml
```

CMS Admin 不属于主站路由，由独立 `apps/cms-admin` Static Assets 应用在专用 Origin 根路径 `/` 提供。

### 5.1 首页 `/`

包含：

- H1 和站点价值说明；
- 精选游戏；
- 最新发布游戏；
- 精选分类；
- 指向 `/games/` 的清晰入口；
- 不超过一个主要 H1；
- 无客户端数据请求。

### 5.2 游戏列表 `/games/`

包含：

- 所有 `status: published` 的游戏；
- 服务端/构建时渲染的卡片链接；
- 标题、简短描述和分类；
- 暂不实现分页；50 个游戏以内一次展示；
- 暂不实现搜索。

### 5.3 游戏详情 `/games/[id]/`

页面顺序：

1. 面包屑；
2. H1；
3. 一句话介绍；
4. 游戏播放器；
5. 游戏基本信息；
6. Markdown 正文；
7. 操作说明；
8. 截图；
9. 相关推荐；
10. 分类链接；
11. 来源和许可证信息；
12. 广告位容器。

### 5.4 分类页 `/category/[id]/`

包含：

- 唯一 H1；
- 分类说明；
- 该分类下所有已发布游戏；
- `CollectionPage` 和 `ItemList` JSON-LD；
- 分类没有游戏时不生成页面。

### 5.5 管理后台独立 Origin

- `noindex, nofollow`；
- 不进入公开主站构建或 Sitemap；
- 不在公共导航中展示；
- 只有具备 GitHub 仓库写权限的用户可以登录；
- 除固定版本并带 integrity 的 Decap client 外避免第三方 JavaScript；
- 不加载广告、公开站点 analytics 或会注入公开站点脚本的环境。

---

## 6. 内容模型

### 6.1 Games Collection

目录：

```text
src/content/games/
```

每个文件名即稳定 ID，例如：

```text
src/content/games/going-balls.md
```

Frontmatter：

```yaml
title: "Going Balls"
seoTitle: "Going Balls – Play Online for Free"
seoDescription: "Play Going Balls online and guide the ball through obstacle courses. Learn the controls, gameplay and mobile support before starting."
shortDescription: "Guide a rolling ball through narrow obstacle courses."
coverImage: "../../assets/images/games/going-balls-cover.webp"
coverAlt: "Going Balls obstacle course gameplay"
screenshots:
  - image: "../../assets/images/games/going-balls-01.webp"
    alt: "Ball rolling across a narrow floating track"
embedUrl: "https://play.example.com/going-balls/index.html"
categories:
  - "ball-games"
  - "skill-games"
tags:
  - "rolling"
  - "obstacle"
  - "3d"
controls:
  - input: "Mouse or arrow keys"
    action: "Move the ball left or right"
featured: true
mobileSupport: "yes"
orientation: "landscape"
loadMode: "click"
aspectRatio: "16/9"
status: "published"
publishedAt: 2026-08-19
updatedAt: 2026-08-19
source:
  name: "Game owner"
  url: "https://example.com"
  license: "Used with permission"
relatedGames: []
```

Markdown body用于：

- 游戏玩法说明；
- 真实差异；
- 关卡或目标；
- 玩家适合人群；
- 操作提示；
- 不得重复 Frontmatter 中的 SEO description 作为正文。

### 6.2 Games 字段约束

- `title`：1–80 字符；
- `seoTitle`：20–65 字符；
- `seoDescription`：70–170 字符；
- `shortDescription`：20–200 字符；
- `embedUrl`：必须为 HTTPS；
- `embedUrl` Origin 必须位于允许列表；
- `embedUrl` 路径必须精确以大小写敏感的 `/index.html` 结尾；
- `categories`：至少 1 项；
- `tags`：最多 12 项；
- `controls`：至少 1 项；
- `screenshots`：最多 8 项；
- `mobileSupport`：`yes | no | partial`；
- `orientation`：`landscape | portrait | both`；
- `loadMode`：`click | eager`；
- `status`：`draft | published`；
- `updatedAt` 不得早于 `publishedAt`；
- `relatedGames` 最多 8 项；
- `relatedGames` 不得包含自身；
- `source.url` 必须为 HTTPS；
- 所有图片必须有非空 alt。

### 6.3 Categories Collection

目录：

```text
src/content/categories/
```

字段：

```yaml
name: "Ball Games"
seoTitle: "Free Ball Games to Play Online"
seoDescription: "Play selected ball games online, including rolling, sports and obstacle games that work directly in your browser."
shortDescription: "Rolling, sports and obstacle games built around ball movement."
order: 10
featured: true
status: "published"
```

规则：

- 游戏只能引用真实存在且已发布的分类；
- 分类 ID 由文件名确定；
- 同一分类名不得重复；
- 无已发布游戏的分类页不生成。

---

## 7. 内容查询接口

所有页面不得直接散落调用 `getCollection()`。集中到以下模块：

```text
src/lib/content/games.ts
src/lib/content/categories.ts
```

要求导出：

```ts
getPublishedGames(): Promise<CollectionEntry<"games">[]>
getFeaturedGames(limit?: number): Promise<CollectionEntry<"games">[]>
getGameById(id: string): Promise<CollectionEntry<"games"> | undefined>
getPublishedCategories(): Promise<CollectionEntry<"categories">[]>
getCategoryById(id: string): Promise<CollectionEntry<"categories"> | undefined>
getGamesForCategory(categoryId: string): Promise<CollectionEntry<"games">[]>
```

排序规则必须确定性：

- 游戏列表：`publishedAt` 降序，ID 升序作为次级条件；
- 分类列表：`order` 升序，ID 升序；
- 相关推荐：显式 `relatedGames` 优先；不足时按共同分类数量、共同标签数量、发布时间、ID 依次排序；
- 最大相关推荐数量为 8。

---

## 8. SEO 规范

### 8.1 Head

所有可索引页面包含：

- 唯一 title；
- meta description；
- canonical；
- Open Graph title、description、URL、image；
- Twitter Card；
- UTF-8 和 viewport；
- 页面语言 `lang="en"`；
- Favicon；
- 无重复 Canonical；
- Canonical 统一使用尾斜杠。

### 8.2 Structured Data

首页：

- `WebSite`；
- `ItemList`，仅列出精选游戏。

游戏页：

- `VideoGame`；
- `BreadcrumbList`；
- `Offer`，价格 0、USD；
- 不虚构 rating、reviewCount、publisher 或 operatingSystem。

分类页：

- `CollectionPage`；
- `ItemList`；
- `BreadcrumbList`。

所有 JSON-LD 必须使用安全的 `JSON.stringify()` 输出，不手工拼接字符串。

### 8.3 Sitemap 和 Robots

- 使用 `@astrojs/sitemap`；
- 只包含生产 URL；
- 防御性排除 `/admin/`，且主站实际不生成该路由；
- 排除 `draft` 内容；
- `robots.txt` 指向 Sitemap；
- Worker 预览域名通过 `_headers` 添加 `X-Robots-Tag: noindex`；
- 生产自定义域名不添加全站 noindex。

### 8.4 内部链接

- 所有游戏页至少链接到 1 个分类；
- 相关推荐最多 8 个；
- 首页和游戏列表必须能通过普通 `<a>` 到达全部游戏；
- 不依赖点击事件完成核心导航；
- 不生成参数化筛选 URL。

---

## 9. GamePlayer 规范

### 9.1 默认加载方式

默认 `loadMode: click`：

- 初始显示封面、游戏名和 Play 按钮；
- 点击后才创建 iframe；
- Play 按钮可键盘操作；
- SEO 文案始终在 HTML 中，不受 iframe 是否加载影响。

允许少量核心游戏使用 `loadMode: eager`。

### 9.2 iframe 属性

最低要求：

```html
<iframe
  title="Play Going Balls"
  allow="fullscreen; autoplay; gamepad"
  sandbox="allow-scripts allow-same-origin allow-pointer-lock"
  referrerpolicy="strict-origin-when-cross-origin"
  allowfullscreen
></iframe>
```

禁止默认添加：

- `allow-popups`；
- `allow-top-navigation`；
- 摄像头；
- 麦克风；
- 地理位置；
- 剪贴板；
- 支付权限。

### 9.3 Origin 校验

构建前校验：

- URL 协议必须为 `https:`；
- Origin 必须匹配 `PUBLIC_GAME_ORIGINS`；
- 路径必须精确以大小写敏感的 `/index.html` 结尾；
- 允许经过审查的安全 query；
- 不允许用户名、密码或 fragment；
- 禁止 `javascript:`、`data:`、`blob:`。

默认允许列表：

```text
https://play.example.com
```

生产部署时通过环境变量替换。

### 9.4 布局和失败状态

- 使用 `aspect-ratio` 预留空间，避免 CLS；
- iframe 加载前后容器尺寸不变；
- 提供“重新加载游戏”按钮；
- 超时或错误时显示可理解的提示；
- 全屏功能使用标准 Fullscreen API；
- 不自动滚动页面；
- 移动端控件最小点击区域 44×44 CSS px。

---

## 10. 广告位

首版只实现广告位容器，不接入任何广告商脚本。

固定 ID：

```text
home-after-featured
game-before-player
game-after-content
category-after-grid
```

`AdSlot` 要求：

- 通过 `src/config/ads.ts` 集中开启或关闭；
- 默认关闭；
- 关闭时不渲染空白高度；
- 开启占位模式时标记 `Advertisement`；
- 不遮挡游戏；
- 不使用弹窗、自动跳转或强制点击；
- 后续接广告代码时只能修改 `AdSlot`，不得散落到页面。

---

## 11. 安全响应头

`public/_headers` 至少包含：

```text
/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()
  X-Frame-Options: DENY

https://:version.:subdomain.workers.dev/*
  X-Robots-Tag: noindex, nofollow

/_astro/*
  Cache-Control: public, max-age=31536000, immutable
```

CSP 需要允许游戏 iframe Origin。因为生产域名由环境变量决定，首版不在主站 `_headers` 中硬编码过度严格 CSP；在配置真实域名后再增加经过验证的 CSP。不得为了“看起来安全”添加会破坏 iframe 的 CSP。

---

## 12. Cloudflare Workers Static Assets

`wrangler.jsonc`：

```jsonc
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "game-site",
  "compatibility_date": "2026-08-19",
  "assets": {
    "directory": "./dist",
    "not_found_handling": "404-page",
    "html_handling": "auto-trailing-slash"
  }
}
```

约束：

- 无 `main`；
- 无 Cloudflare Astro SSR Adapter；
- 无数据库绑定；
- 无 secret 写入文件；
- `npm run deploy` 先执行完整验证，再执行 Wrangler；
- 生产部署使用自定义域名；
- `workers.dev` 仅用于预览并 noindex。

---

## 13. R2 发布约定

正式入口 URL 与对象键精确对应：

```text
public URL: https://play.example.com/<slug>/index.html
object key: <slug>/index.html
assets: <slug>/assets/<content-hashed-file>
archive: _releases/<slug>/<version>/...
```

每个游戏包最低包含：

```text
index.html
assets/...
```

要求：

- 所有游戏资源使用相对 URL；
- 禁止依赖主站 Cookie；
- 禁止跳转顶层页面；
- 生产使用自定义域名；
- 不假设 `/<slug>/` 自动映射到 `<slug>/index.html`；
- 不添加 Worker 或 rewrite 隐藏 `index.html`；
- `index.html` 使用 `no-cache` 或经过审查的短缓存；
- 先上传带 hash 的 JS/CSS/图片并使用一年 immutable 缓存，最后上传 `index.html`；
- 回滚时恢复同一个 `<slug>/index.html` key；
- 每个游戏保存来源、许可证和版本记录。

首版 Codex 只编写 R2 部署文档和验证清单，不实现在线上传后台。

---

## 14. Decap CMS

### 14.1 后台字段

后台必须能编辑：

- 游戏标题；
- SEO title；
- SEO description；
- 简短描述；
- 封面和 alt；
- 截图和 alt；
- iframe URL；
- 分类；
- 标签；
- 操作说明；
- 精选开关；
- 移动端支持；
- 方向；
- 加载模式；
- 发布状态；
- 发布时间、更新时间；
- 来源、URL、许可证；
- Markdown 正文；
- 分类内容；
- 广告位全局开关。

### 14.2 生产认证

生产认证流程：

```text
cms.example.com/
  → cms-auth.example.com/auth
  → GitHub OAuth
  → cms-auth.example.com/callback
  → Decap CMS
  → GitHub commit
  → CI build
  → Workers Static Assets deploy
```

OAuth Worker：

- 独立目录 `apps/cms-auth/`；
- 独立 `wrangler.jsonc`；
- secrets：GitHub Client ID 和 Client Secret；
- 不记录 access token；
- 不在日志中输出 authorization code；
- 只允许配置的专用 CMS Admin Origin；
- 代码来源和许可证保留；
- 必须单独 PR 验收。

---

## 15. 测试策略

### 15.1 单元测试

使用 Vitest 测试：

- URL allowlist；
- 相关推荐排序；
- SEO title/description fallback；
- Canonical URL；
- 内容排序；
- Draft 过滤；
- 广告配置。

### 15.2 构建输出测试

构建后使用 Cheerio 检查：

- 首页、一个游戏页、一个分类页存在；
- 每页唯一 title；
- 每页存在 description 和 canonical；
- 游戏页源码含 H1、正文、分类链接和 JSON-LD；
- iframe 在 `click` 模式下初始不存在；
- Play 按钮存在；
- Draft 游戏不输出；
- Sitemap 不包含 `/admin/` 和 Draft，主站 dist 不包含 Admin HTML；
- Robots 指向 Sitemap；
- 内部链接无缺失目标；
- 404 页面存在。

### 15.3 E2E

使用 Playwright：

- 首页打开；
- 进入游戏详情；
- 点击 Play 后 iframe 出现；
- 全屏按钮可聚焦；
- 分类导航有效；
- 404 返回自定义内容；
- 核心页面 Axe 严重级别违规为 0。

### 15.4 每次 PR 的强制命令

```bash
npm ci
npm run format:check
npm run check
npm run test
npm run build
npm run verify:dist
npm run test:e2e
npx wrangler deploy --dry-run
```

在前几轮尚未引入 E2E 时，`npm run test:e2e` 可在对应 PR 后才成为强制项。

---

## 16. CI

GitHub Actions 在 PR 和 main push 时运行：

1. Node.js 24；
2. `npm ci`；
3. format check；
4. Astro type/content check；
5. unit tests；
6. production build；
7. dist verification；
8. E2E；
9. deploy dry-run。

main 自动部署只在以下条件满足后启用：

- 所有前置 PR 验收通过；
- Cloudflare API Token 和 Account ID 已配置；
- 自定义域名准备完成；
- 用户明确允许自动部署。

在此之前，main 只构建，不自动发布。

---

## 17. PR 分轮策略

禁止一次完成整个站点。按以下顺序：

1. **PR 1：项目骨架、工具链、CI 基线**
2. **PR 2：内容模型、查询层、静态路由**
3. **PR 3：SEO、结构化数据、Sitemap、构建输出验证**
4. **PR 4：GamePlayer、iframe 安全、R2 部署文档**
5. **PR 5：Decap CMS 和 Cloudflare OAuth Worker**
6. **PR 6：广告位、E2E、无障碍、部署硬化**

每轮：

- Codex 只执行当前 PR；
- 提交多个小 commit；
- 推送分支；
- 开 Draft PR；
- 报告验证命令和真实输出；
- 用户把 PR 链接交给 ChatGPT；
- ChatGPT 检查 diff、完整文件、CI 和验收清单；
- Critical/Important 问题必须在同一 PR 修复；
- ChatGPT 明确回复“本轮验收通过”后才合并；
- 上一轮合并后再开始下一轮。

---

## 18. 完成定义

首版完成必须同时满足：

- 所有公开页面为构建时静态 HTML；
- 主站仓库不包含游戏包；
- 至少有 3 个示例游戏和 2 个示例分类；
- 所有示例内容通过 schema；
- 游戏、分类和首页源码包含完整 SEO 内容；
- GamePlayer 只加载允许 Origin；
- `http://127.0.0.1:4322/` 的独立 CMS Admin 可本地编辑；
- 生产 OAuth Worker 有独立文档和测试；
- CI 全绿；
- Wrangler dry-run 成功；
- 无 secret 入库；
- 内部链接检查通过；
- Draft 内容不发布；
- 预览域名 noindex；
- 生产部署步骤可由新开发者按文档复现；
- 每个 PR 均经过独立验收。
