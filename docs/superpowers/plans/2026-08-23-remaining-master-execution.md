# GameTemplate-Astro 剩余工作总执行书

> 交给 Codex 使用。  
> 目标：从当前已合并的 PR 5A 一次性规划并执行完 **PR 5B、PR 6、生产上线与最终验收**。  
> 不再把普通缺陷、测试失败、格式问题、文档补充拆成新的微型指令。Codex 必须在当前阶段内自行调试、修复、回归，直到达到阶段完成门槛。

---

## 0. 当前已确认基线

仓库：

```text
Micmyw/GameTemplate-Astro
```

当前 `main`：

```text
d3f9e74f130b8be594b02406fa540ff281111e2e
```

已完成：

```text
PR 1  Foundation
PR 2  Typed content and static routes
PR 3  SEO / metadata / structured data / sitemap
PR 4  GamePlayer / iframe security / R2 release contract
PR 5A Local Decap CMS / isolated CMS Admin / OAuth Worker / security headers
```

合并后的 main CI：

```text
Run 32624636679
Static site quality gates                 SUCCESS
CMS Admin static asset quality gates      SUCCESS
CMS OAuth Worker quality gates            SUCCESS
```

当前生产状态：

```text
PR 5B production CMS authentication       NOT STARTED
PR 6 launch hardening                     NOT STARTED
Main-site production deployment           NOT STARTED
CMS Admin production deployment           NOT STARTED
CMS OAuth Worker production deployment    NOT STARTED
R2 real game upload                       NOT STARTED
Real OAuth login                          NOT STARTED
Real CMS content write                    NOT STARTED
```

---

# 1. 总执行规则

## 1.1 不再“做一点就汇报一点”

除本文件明确列出的硬门禁外，Codex 不得因为以下情况停止并把问题退回用户：

- 测试失败；
- 格式检查失败；
- TypeScript 错误；
- Wrangler dry-run 失败；
- Playwright 失败；
- Lighthouse 诊断不理想；
- 文档不一致；
- 小范围架构冲突；
- CI 首次失败；
- Windows/Linux 换行或路径差异；
- 依赖安装或生成文件格式差异；
- 可在仓库内自行确认的配置问题。

遇到这些问题时必须：

```text
定位根因
→ 写或补充失败测试
→ 修复
→ 重跑相关测试
→ 重跑完整阶段验证
→ 在同一个 Draft PR 中继续
```

不得每发现一个问题就创建新 PR，也不得要求用户重新给一份详细任务书。

## 1.2 只允许三个硬暂停点

Codex 只允许在以下情况暂停：

### GATE A — 缺少一次性的生产输入

只允许一次性请求完整输入，不得分多轮逐项追问。

### GATE B — 需要用户在交互式终端输入 Secret 或完成无法通过仓库完成的 OAuth App 操作

不得要求用户把 Secret 粘贴到聊天、Git、PR、日志或命令参数。

### GATE C — 需要人工合并 Draft PR

仓库 `AGENTS.md` 规定 Codex 永不合并分支。Codex必须完成整个当前 PR、打开 Draft PR、等待独立验收和人工合并。

除以上三个门禁外，不得暂停。

## 1.3 剩余工作只有两个开发 PR

```text
Project PR 5B — Production CMS authentication
Project PR 6  — Launch hardening and final production readiness
```

GitHub 实际 PR 编号可能是 #6、#7 或更高，但项目阶段名称不能混淆。

## 1.4 持久化本总计划

首次执行时，将本文件保存到：

```text
docs/superpowers/plans/2026-08-23-remaining-master-execution.md
```

后续任何新会话只需用户发送：

```text
继续执行剩余总计划
```

Codex 应读取该文件、检查 Git 和远程状态，并从第一个未完成门禁继续。不得要求用户再次粘贴整份计划。

## 1.5 默认技术决策

除非生产输入明确覆盖，否则采用：

```text
GitHub OAuth App owner: Micmyw
GitHub repository:       Micmyw/GameTemplate-Astro
GitHub branch:           main
CMS backend scope:       public_repo
CMS client:              Decap CMS 3.15.1 pinned with SRI
Node:                    24
Package manager:         npm
Wrangler:                4.124.0
Main site:               Astro static output
CMS Admin:               Workers Static Assets, no main
CMS Auth:                Cloudflare Worker
Game files:              Cloudflare R2 custom domain
Ad vendor:               none
Ad slots:                disabled by default
Analytics:               none unless explicitly selected
```

不要为了“现代化”自行替换框架、CMS、OAuth 方案或托管平台。

---

# 2. 一次性生产输入门禁

## 2.1 Codex 只问一次

若下列输入尚未提供，Codex 必须一次性输出完整模板并停止：

```text
CONTINUE REMAINING MASTER PLAN

PRIMARY_DOMAIN=
GITHUB_OAUTH_APP_OWNER=Micmyw
GITHUB_EDITING_ACCOUNT=Micmyw
USE_DEDICATED_GITHUB_EDITOR=false
CLOUDFLARE_ACCOUNT_NAME=
CLOUDFLARE_ZONE_NAME=
REAL_GAME_PACKAGE_PATH=NONE
```

用户只需提供一个主域名，Codex 自动派生：

```text
PUBLIC_SITE_ORIGIN=https://<PRIMARY_DOMAIN>
CMS_ADMIN_ORIGIN=https://cms.<PRIMARY_DOMAIN>
CMS_AUTH_ORIGIN=https://cms-auth.<PRIMARY_DOMAIN>
GAME_ORIGIN=https://play.<PRIMARY_DOMAIN>
```

若用户明确给出不同子域结构，则使用用户值。

默认：

```text
CLOUDFLARE_ZONE_NAME=<PRIMARY_DOMAIN>
GITHUB_OAUTH_APP_OWNER=Micmyw
GITHUB_EDITING_ACCOUNT=Micmyw
```

`REAL_GAME_PACKAGE_PATH=NONE` 表示本轮完成模板和部署能力，但最终报告必须明确：

```text
Real playable game upload: NOT COMPLETED
```

不得伪造游戏已上传。

## 2.2 输入校验

四个 Origin 必须：

- 使用 HTTPS；
- 仅包含 Origin；
- 不含 path；
- 不含 query；
- 不含 fragment；
- 不含 credentials；
- 不使用 `.example.test`；
- 互不相同；
- CMS Admin 不加载广告或公开站 analytics；
- CMS Auth 只运行 OAuth Worker；
- GAME Origin 只承载游戏资源。

如果只提供主域名，Codex不得继续追问四个 Origin，直接按默认子域派生。

## 2.3 Secret 规则

以下值永远不得出现在聊天、Git、PR、截图、日志或命令参数：

- GitHub OAuth Client Secret；
- GitHub OAuth access token；
- OAuth authorization code；
- 完整 state；
- Cloudflare API Token；
- replayable Cookie；
- `localStorage["decap-cms-user"]` 的值。

OAuth Client ID 也按本项目的保守策略通过 Cloudflare Secret 输入。

只允许：

```bash
npx wrangler secret put GITHUB_OAUTH_ID --env production
npx wrangler secret put GITHUB_OAUTH_SECRET --env production
```

用户只在交互式提示中输入值。

---

# 3. Project PR 5B — Production CMS authentication

## 3.1 分支与 PR

从最新 `main` 创建：

```text
Branch: feat/game-cms-production
Draft PR title: feat: configure production CMS authentication
```

开始前：

```bash
git fetch origin --prune
git switch main
git pull --ff-only origin main
git status --short
git rev-parse HEAD
```

必须确认当前 main 包含：

```text
d3f9e74f130b8be594b02406fa540ff281111e2e
```

如 main 更晚，使用最新 main。

使用隔离 worktree；不得从已删除的 `feat/game-cms` 继续。

## 3.2 PR 5B 的全部代码范围

本 PR 一次性完成：

1. 生产 Origin 配置；
2. 生产配置验证器；
3. CMS Admin 正式 hostname 加载；
4. CMS `base_url` / `auth_endpoint`；
5. OAuth Worker production environment；
6. 生产 dry-run；
7. OAuth Worker 真实部署；
8. CMS Admin 真实部署；
9. 真实只读 OAuth 登录；
10. Origin localStorage 隔离证明；
11. 完整自动测试；
12. 完整文档；
13. Draft PR 与证据。

不得把这些再拆成多个代码 PR。

## 3.3 修正文档中的旧架构残留

检查并修正：

```text
docs/superpowers/specs/2026-08-19-seo-game-site-design.md
docs/superpowers/plans/2026-08-19-seo-game-site.md
docs/deployment/cms-auth.md
docs/deployment/pr5-production-runbook.md
```

必须移除或更新旧结构：

```text
public/admin/
example.com/admin/
CMS_SITE_ORIGIN
```

最终文件结构必须显示：

```text
apps/cms-admin/
apps/cms-auth/
```

不得让设计规格与实际架构长期冲突。

## 3.4 生产配置的实现原则

测试默认环境继续使用：

```text
https://cms.example.test
https://cms-auth.example.test
```

新增正式 `production` environment，不得覆盖测试默认。

OAuth Worker production bindings：

```text
CMS_ADMIN_ORIGIN=<real CMS Admin Origin>
CMS_AUTH_ORIGIN=<real CMS Auth Origin>
```

生产配置不得出现 `.example.test`。

所有 callback 必须由 `CMS_AUTH_ORIGIN` 构建。

所有 popup `postMessage` target 必须为 `CMS_ADMIN_ORIGIN`。

## 3.5 生产配置验证器

创建可重复运行的生产配置验证器。建议：

```text
scripts/verify-production-config.mjs
apps/cms-admin/scripts/verify-production-config.mjs
apps/cms-auth/scripts/verify-production-config.mjs
```

也可以使用一个共享模块，但不得形成复杂框架。

必须拒绝：

- 缺少真实主域名；
- `.example.test`；
- `example.com` 占位；
- HTTP Origin；
- 含 path/query/fragment/credentials 的 Origin；
- 任意两个角色 Origin 相同；
- CMS Admin 与 Public Site 相同；
- CMS Auth 与 Public Site 相同；
- GAME 与 Public Site 相同；
- 缺少 `base_url`；
- `auth_endpoint !== /auth`；
- wildcard callback；
- wildcard postMessage；
- Admin 生产 hostname 仍被 local-only guard 阻止；
- CMS Admin 缺 `_headers`；
- CMS Admin 缺 noindex/no-store/clickjacking 防护；
- CMS Admin 出现广告或 analytics；
- 主站重新出现 Decap；
- OAuth Worker 开启 invocation URL logging 或 traces；
- 生产 Worker 仍使用 placeholder vars；
- Secret 出现在配置文件；
- `.dev.vars` 被跟踪。

必须有完整的失败 fixture。

## 3.6 CMS Admin 正式加载

修改：

```text
apps/cms-admin/public/index.html
```

允许：

- localhost；
- 127.0.0.1；
- ::1；
- 精确的真实 `CMS_ADMIN_ORIGIN` hostname。

不得使用：

- 任意远程 hostname；
- 后缀模糊匹配；
- `endsWith(primaryDomain)`；
- wildcard；
- Referer 决定加载；
- `latest` CDN。

继续保留：

- Decap 3.15.1；
- SRI；
- crossorigin=anonymous；
- local favicon；
- dedicated-Origin 注释；
- 无广告；
- 无 analytics。

## 3.7 CMS backend 生产配置

修改唯一配置：

```text
apps/cms-admin/public/config.yml
```

增加：

```yaml
backend:
  name: github
  repo: Micmyw/GameTemplate-Astro
  branch: main
  auth_scope: public_repo
  base_url: <CMS_AUTH_ORIGIN>
  auth_endpoint: /auth
```

继续保留 `local_backend`。

不得改变：

- collection 字段；
- media paths；
- relations；
-日期；
- draft/published 语义。

## 3.8 GitHub OAuth App 硬门禁

若 Codex 无法通过已认证浏览器创建 GitHub OAuth App，只允许一次性输出以下人工操作并停止在 GATE B：

```text
Application name: GameTemplate Astro CMS
Homepage URL: <CMS_ADMIN_ORIGIN>
Authorization callback URL: <CMS_AUTH_ORIGIN>/callback
Owner: <GITHUB_OAUTH_APP_OWNER>
```

用户创建完成后，只回复：

```text
OAUTH APP CREATED
```

不得要求用户发 Client ID 或 Secret。

然后 Codex 在用户的终端会话中执行两个交互式 secret 命令，由用户直接输入。

## 3.9 OAuth Worker 部署

执行完整验证：

```bash
cd apps/cms-auth
npm ci
npm run format:check
npm run check
npm run test
npx wrangler types
npm run verify:production-config
npx wrangler deploy --dry-run --env production
```

通过后执行真实部署：

```bash
npx wrangler deploy --env production
```

绑定 `CMS_AUTH_ORIGIN`。

记录：

- deployment ID；
- 旧版本 ID；
- custom domain 状态；
- 不含敏感值的 dry-run 摘要。

不得记录完整 Location、state、Cookie、code 或 token。

## 3.10 OAuth Worker 真实探测

验证 `/auth`：

- 302；
- GitHub authorize endpoint；
- callback 精确；
- `scope=public_repo`；
- Secure/HttpOnly/SameSite=Lax/Path=/Max-Age=600；
- 无 Domain；
- no-store；
-不泄露 Secret。

验证 `/callback` 缺少参数：

- 400；
- no-store；
- no-referrer；
- nosniff；
- DENY；
-无敏感值。

验证错误 Origin：

- 403。

## 3.11 CMS Admin 部署

执行：

```bash
cd apps/cms-admin
npm ci
npm run format:check
npm run test:headers
npm run verify:production-config
npx wrangler deploy --dry-run --env production
```

通过后真实部署：

```bash
npx wrangler deploy --env production
```

绑定 `CMS_ADMIN_ORIGIN`。

验证真实响应：

```text
/
config.yml
preview.css
favicon.svg
```

必须有：

- noindex；
- no-store；
- nosniff；
- strict-origin-when-cross-origin；
- DENY；
- frame-ancestors none；
- base-uri none；
- object-src none。

`/_headers` 必须不可作为普通文件读取。

## 3.12 真实 OAuth 登录

在干净浏览器配置中：

1. 打开 CMS Admin；
2. 登录 GitHub；
3. 验证 Games 和 Categories 可读；
4. 验证图片预览；
5. 验证 relation；
6. 验证 console 无错误；
7. 验证 token 不在 URL；
8. 验证无 wildcard postMessage。

只记录：

```text
localStorage key decap-cms-user exists: YES
```

绝不记录值。

在 Public Site Origin 验证：

```text
decap-cms-user key exists: NO
Cannot read CMS Admin localStorage: CONFIRMED
```

## 3.13 PR 5B 合并前禁止写内容

在 Draft PR 合并前：

- 只读登录；
- 不保存内容；
- 不上传媒体；
- 不创建 CMS commit；
- 不发布 draft。

## 3.14 PR 5B 自动测试

至少覆盖：

- real production Origin parser；
- all-origin distinctness；
- Admin hostname exact matching；
- placeholder rejection；
- base_url/auth_endpoint；
- local backend preserved；
- no public-site Decap；
- no Admin ads/analytics；
- `_headers`；
- production dry-run；
- OAuth tests；
- schema parity；
- content round-trip；
- no tracked secret；
- no `.dev.vars`；
- no production values in test default.

## 3.15 PR 5B 完整验证

Root：

```bash
npm ci
npm run format:check
npm run check
npm run test
npm run build
npm run verify:dist
npx wrangler deploy --dry-run
```

CMS Admin：

```bash
cd apps/cms-admin
npm ci
npm run format:check
npm run test:headers
npm run verify:production-config
npx wrangler deploy --dry-run --env production
cd ../..
```

OAuth Worker：

```bash
cd apps/cms-auth
npm ci
npm run format:check
npm run check
npm run test
npx wrangler types
npm run verify:production-config
npx wrangler deploy --dry-run --env production
cd ../..
```

## 3.16 PR 5B Draft PR 输出

打开 Draft PR，正文一次性包含：

- Scope；
- Base / Head；
- commits；
- changed files；
-四 Origin；
-生产配置验证矩阵；
- Worker dry-run / deployment；
- Admin dry-run / deployment；
-真实 Headers；
-真实只读 OAuth 登录；
-localStorage 隔离；
-no-write 声明；
-全部 CI；
-Secret 扫描；
-回滚信息；
-已知问题；
-计划偏离。

然后按 AGENTS 停止等待验收和人工合并。

## 3.17 PR 5B 合并后 smoke test

人工合并后，用户只需发送：

```text
继续执行剩余总计划
```

Codex必须：

1. 同步 main；
2. 确认 main CI；
3. 打开 CMS；
4. 修改 `obstacle-orbit` draft 的一行无害文字；
5. 保持 `status: draft`；
6. 确认 CMS 产生 Git commit；
7. 确认 main CI；
8. 确认 draft route 不生成；
9. 确认 Sitemap 不包含 draft；
10. 确认没有媒体写入 `public/`；
11. 通过第二个正常 commit 恢复测试文字，或保留明确验证说明；
12. logout；
13. 确认 `decap-cms-user` key 已清除。

完成后自动进入 Project PR 6，不需要重新索要详细指令。

---

# 4. Project PR 6 — Launch hardening and final production readiness

## 4.1 分支与 PR

从 PR 5B 合并后的最新 main 创建：

```text
Branch: feat/launch-hardening
Draft PR title: feat: harden game site for launch
```

本 PR 一次性完成以下所有内容，不再拆分：

1. Ad Slots；
2. Playwright E2E；
3. Axe accessibility；
4. Main production config gate；
5. Main deploy scripts；
6. Deployment docs；
7. R2 launch readiness；
8. Final requirement matrix；
9. Screenshots；
10. Lighthouse diagnostics；
11. Full CI；
12. Draft PR。

## 4.2 Task 15 — 集中广告位

创建：

```text
src/config/ads.ts
src/components/ads/AdSlot.astro
tests/unit/ads.test.ts
tests/integration/ad-slots.test.ts
```

命名 slot：

```text
home-after-featured
game-before-player
game-after-content
category-after-grid
```

默认：

```text
disabled
```

要求：

- disabled 时不输出 wrapper；
- disabled 时无布局空隙；
- enabled placeholder 显示 `Advertisement`；
- unknown slot 编译失败；
- 不加载广告供应商脚本；
- 不写 AdSense ID；
- 不写测试广告 ID；
- 不在 CMS Admin 添加广告。

接入首页、游戏页、分类页。

## 4.3 Task 16 — Playwright 与 Axe

安装：

```text
@playwright/test
@axe-core/playwright
```

增加：

```text
playwright.config.ts
tests/e2e/public-pages.spec.ts
npm run test:e2e
```

测试至少覆盖：

- 首页加载；
- 首页到游戏导航；
- 游戏 H1/正文在点击 Play 前可见；
- Play 只创建一个 iframe；
- Reload 替换 iframe；
- Fullscreen failure 有提示；
- 分类导航；
- 404；
- keyboard focus；
- reduced-motion；
- desktop；
- mobile；
- zero Axe serious/critical violations：
  - 首页；
  - 一个游戏页；
  - 一个分类页；
  - 404。

不得依赖真实外部游戏网络。Playwright 应拦截或 mock `GAME_ORIGIN` 的 iframe 响应，返回一个最小合成 HTML，验证 iframe 行为但不访问互联网。

## 4.4 E2E CI

CI 安装 Chromium 与依赖。

主站 job 顺序：

```text
npm ci
format
check
unit/integration tests
build
verify:dist
Playwright E2E
Wrangler dry-run
```

上传失败时的 Playwright report、trace、screenshots 作为短期 CI artifact。

成功时无需长期保留大体积 artifact。

## 4.5 Main production config gate

创建根级：

```text
verify:production-config
```

必须拒绝：

- `PUBLIC_SITE_URL` 缺失；
- `https://example.com`；
- `.example.test`；
- 非 HTTPS；
- path/query/fragment/credentials；
- `PUBLIC_GAME_ORIGINS` 缺失；
- game origin placeholder；
- public/game/cms-admin/cms-auth 任意角色相同；
- source HTML canonical 使用错误 Origin；
- robots Sitemap Origin 错误；
- Sitemap 含 draft/admin/404；
- workers.dev 公开预览可被索引；
-主站重新出现 Decap；
-主站出现未批准广告脚本；
-广告 slot 默认开启；
-生产 deploy 可绕过完整测试。

新增：

```text
deploy:production:dry
deploy:production
```

生产 deploy 必须运行：

```text
format
check
tests
build with real env
verify:dist
test:e2e
verify:production-config
wrangler dry-run
```

不要设置自动部署到生产。

## 4.6 Task 17 — 部署、回滚和 launch 文档

创建或更新：

```text
docs/deployment/workers-static-assets.md
docs/deployment/r2.md
docs/review/acceptance-checklist.md
docs/launch-checklist.md
```

必须包含：

- main site env；
- main static deploy；
- custom domain；
- workers.dev noindex；
- 404；
- `_headers`；
- versions rollback；
- R2 custom domain；
- game package validation；
- immutable assets；
- index.html no-cache；
- rollback；
- CMS Admin/Auth origins；
- Secret handling；
- GSC property；
- Sitemap；
- URL Inspection；
- source HTML；
- canonical；
- robots；
- iframe mobile；
- legal pages；
- ad slots disabled；
- analytics 未选择；
- Git backup；
- incident response。

## 4.7 R2 真实游戏准备

若 `REAL_GAME_PACKAGE_PATH` 不是 `NONE`：

1. 不复制到主站仓库；
2. 运行 `game:validate`；
3. 生成 release manifest；
4. 计算 hash；
5. 上传 immutable assets；
6. 最后上传 `index.html`；
7. 绑定 GAME custom domain；
8. 验证真实 `/slug/index.html`；
9. 更新相应游戏 `embedUrl`；
10. build；
11. E2E；
12. mobile smoke；
13. rollback test。

若为 `NONE`：

- 不生成虚假游戏；
- 不上传测试 HTML冒充真实游戏；
- 保持代码和部署能力完成；
- final report 明确 playable production content 尚未完成；
- 不声称网站可正式对用户开放。

## 4.8 视觉和性能验证

必须提供：

- desktop 首页；
- mobile 首页；
- desktop 游戏页点击前；
- mobile 游戏页点击前；
- game iframe mock 加载后；
- category page；
- 404；
- CMS Admin 登录后的脱敏截图（不得含 token）。

Lighthouse：

- desktop diagnostics；
- mobile diagnostics；
- Performance；
- Accessibility；
- Best Practices；
- SEO。

Lighthouse 是诊断，不替代测试。

修复明确、低风险的问题；不得为了追分大改视觉或引入复杂缓存。

## 4.9 完整 requirement matrix

生成：

```text
docs/review/final-requirement-matrix.md
```

每一条 design spec 映射到：

- 文件；
- 测试；
- CI；
- 证据；
-状态：
  - PASS
  - MANUAL
  - NOT APPLICABLE
  - BLOCKED

禁止用模糊“已完成”替代具体映射。

## 4.10 PR 6 完整验证

```bash
npm ci
npm run format:check
npm run check
npm run test
npm run build
npm run verify:dist
npm run test:e2e
npm run verify:production-config
npx wrangler deploy --dry-run
git diff --check origin/main...HEAD
git status --short
```

还要重新验证：

```text
CMS Admin CI
CMS OAuth Worker CI
```

不得因 PR6 不修改它们就删除对应 job。

## 4.11 PR 6 Draft PR

正文一次性包含：

- Scope；
- commits；
- changed files；
-广告 slot matrix；
-E2E matrix；
-Axe；
-生产 config gate；
-dry-run；
-R2 状态；
-screenshots；
-Lighthouse；
-requirement matrix；
-CI；
-no secret scan；
-已知问题；
-未完成项；
-回滚。

然后按 AGENTS 停止，等待独立验收与人工合并。

---

# 5. PR 6 合并后的最终生产上线

用户人工合并 PR6 后，只需发送：

```text
继续执行剩余总计划
```

Codex不得再索要新计划，直接执行本节。

## 5.1 同步 main 和 CI

确认：

- local main；
- origin/main；
- merge SHA；
-所有三个现有 CI job；
-Playwright job；
-最终 production gate。

## 5.2 Main site 生产部署

使用真实：

```text
PUBLIC_SITE_URL
PUBLIC_SITE_NAME
PUBLIC_GAME_ORIGINS
```

执行：

```bash
npm ci
npm run format:check
npm run check
npm run test
npm run build
npm run verify:dist
npm run test:e2e
npm run verify:production-config
npx wrangler deploy --dry-run
npx wrangler deploy
```

绑定 `PUBLIC_SITE_ORIGIN`。

记录旧版本和新版本 ID。

## 5.3 真实生产检查

验证：

- 首页 200；
- published 游戏页 200；
-分类页 200；
-404；
-robots；
-sitemap index；
-子 sitemap；
-canonical；
-OG；
-Twitter；
-JSON-LD；
-workers.dev noindex；
-自定义域可 index；
-Admin 不在 main site；
-广告 slot disabled；
-无 analytics；
-iframe 点击模式；
-mobile；
-security headers；
-Core Web Vitals 基础诊断。

## 5.4 GSC

人工或浏览器可操作时：

- 添加 Domain property 或 URL-prefix property；
-验证；
-提交 sitemap-index.xml；
-URL Inspection：
  - 首页；
  - 一个游戏页；
  -一个分类页；
-记录具体日期；
-不保证立即索引；
-不伪造排名。

## 5.5 最终回滚演练

至少完成一次不影响用户的回滚确认：

-确认前一 Worker version；
-确认回滚命令；
-不一定切换流量；
-记录步骤；
-确认 R2 index.html 上一版本可恢复；
-确认 CMS Admin/Auth 前一 deployment 可恢复。

## 5.6 最终报告

只报告真实状态：

```text
Code complete
PR 5B merged
PR 6 merged
Main deployed
CMS Admin deployed
CMS Auth deployed
OAuth login verified
CMS write verified
R2 real game uploaded
GSC configured
```

任何未完成项写：

```text
NOT COMPLETED
```

不得用 dry-run 代替 deployment。
不得用 unit test 代替 OAuth login。
不得用 placeholder game 代替 real game package。
不得用 sitemap 提交代替索引成功。

---

# 6. 用户今后需要做的最少交互

整个剩余流程，用户只需要承担以下无法消除的动作：

1. 一次性提供主域名和账号选择；
2. 在 GitHub 网页创建 OAuth App（若 Codex 无法操作网页）；
3. 在交互式 terminal 输入两个 Secret；
4. 人工合并 PR 5B；
5. 人工合并 PR 6。

除此之外，Codex必须自行完成开发、测试、调试、文档、CI、截图、dry-run、部署和证据整理。

用户在每个合并后只需发送：

```text
继续执行剩余总计划
```

不得再要求用户接收一份新的详细执行方案。
