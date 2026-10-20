# Beerlao 落地页与投放线索后台

## 启动

```powershell
cd "D:\biancheng\编程工具\codex-test\投流-SEO-GUO方向\投流\落地页学习\beerlao-landing"
npm start
```

- 落地页：http://127.0.0.1:4173/
- 后台：http://127.0.0.1:4173/admin
- 默认后台账号：`beerlao`
- 默认后台密码：`beerlao-demo`

公开部署前必须设置环境变量 `ADMIN_PASSWORD`，并将 `DEMO_MODE=0`。参考 `.env.example`。

## 当前版本

落地页采用 B · 稻田木刻方向：

- 深绿旧纸色、稻田野景、木刻感大字与红色印章。
- 330ml × 24 瓶整箱说明。
- 老挝原产地照片与署名。
- 24 瓶分配计算器。
- 整箱报价表单。
- 访问、CTA 点击、滚动深度和留资事件采集。

后台采用图标栏 + 安静数据看板：

- 访问人数、咨询点击、留资线索、访问转化率。
- 访问 → 咨询点击 → 留资漏斗。
- 每日访问折线图与每日留资柱状图。
- 来源分布与来源明细。
- 最近线索和全部线索。
- 可更新新线索、已联系、已报价、已成交、已流失状态。
- 支持载入/清空演示数据。

## 埋点

页面通过 `tracking.js` 发送事件：

- `page_view`：页面首次加载。
- `cta_click`：点击带有 `data-track-cta` 的按钮或链接。
- `scroll_75`：页面滚动达到 75%。

UTM 参数支持：

```text
?utm_source=douyin&utm_medium=paid&utm_campaign=beerlao-q4
```

首次来源会保存在浏览器 localStorage，用于来源归因。

## API

公开接口：

- `POST /api/events`：事件采集。
- `POST /api/leads`：报价表单提交。

后台接口（HTTP Basic Auth）：

- `GET /api/stats?days=30&source=all`
- `GET /api/leads?days=30&source=all&status=all`
- `PATCH /api/leads/:id`
- `POST /api/admin/demo`：`{"action":"seed"}` 或 `{"action":"clear"}`

## 数据存储

当前数据保存在 `data/store.json`，适合本地原型和小规模验证，不是生产级数据库。

正式上线前建议替换为：

- PostgreSQL / MySQL；
- 正式登录与权限控制；
- HTTPS；
- 反向代理；
- IP 限流与表单防刷；
- 隐私政策、数据保留期限和删除机制；
- 酒类销售所需资质、价格、酒精度、保质期、进口商与法定警示语。

## 文件

- `index.html`：最终落地页。
- `admin.html`：后台看板。
- `admin.js` / `admin.css`：后台交互与样式。
- `tracking.js`：落地页事件采集。
- `lead-form.js`：报价表单提交。
- `server.mjs`：无依赖 Node.js 服务。
- `charts.js` / `app.css`：Taste Skill 的后台图表与中性基础样式。
- `index-label.html`：绿标档案方向预览。
- `rice-print.css`：当前 B · 稻田木刻最终页样式。
- `index-poster.html` / `index-editorial.html`：A/C 方向预览。

## 来源自动识别

落地页按以下顺序判断来源：

1. `utm_source` 或 `source` 参数。
2. 广告点击 ID：`fbclid`、`ttclid`、`gclid`、`msclkid`、`yclid`。
3. `document.referrer` 域名。
4. 以上都没有时记为 `direct`。

后台会统一识别别名，例如：

- `fb`、`facebook.com`、`meta` → Facebook
- `tt`、`tiktok.com` → TikTok
- `ins`、`ig`、`instagram.com` → Instagram
- `google.com`、`adwords` → Google
- `bing.com`、`microsoft` → Bing
- `weixin`、`wx` → 微信
- `xhs`、`xhslink.com` → 小红书

如果 `IS` 是独立渠道，直接使用 `utm_source=is`，后台会显示为 `IS`。

推荐投放链接：

```text
https://你的域名/?utm_source=facebook&utm_medium=paid&utm_campaign=beerlao-q4
https://你的域名/?utm_source=tiktok&utm_medium=paid&utm_campaign=beerlao-q4
https://你的域名/?utm_source=instagram&utm_medium=paid&utm_campaign=beerlao-q4
https://你的域名/?utm_source=is&utm_medium=paid&utm_campaign=beerlao-q4
```

注意：Facebook、TikTok、Instagram 的站内浏览器经常不传递 referrer，因此 UTM 参数仍然是投放归因最可靠的方式。


