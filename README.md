# 西宁城北吾悦广场 3F 暑期活动 H5

正式系统由三部分组成：

- Cloudflare Pages：顾客首页、商户发券、商户核销和后台管理页面
- Cloudflare Pages Functions：公开配置、商户口令和后台配置接口
- Supabase：商户、券类型、发券、核销及活动配置数据

## 正式地址

- 活动首页：`https://xining-chengbei-wuyue-3f.pages.dev/`
- 商户发券：`https://xining-chengbei-wuyue-3f.pages.dev/?role=merchant`
- 商户核销：`https://xining-chengbei-wuyue-3f.pages.dev/?role=redeem`
- 后台管理：`https://xining-chengbei-wuyue-3f.pages.dev/?role=admin`

## 发布

修改 `static-h5/app-src.js` 后执行：

```bash
pnpm run deploy:cloudflare
```

生产环境密钥只保存在 Cloudflare 加密环境变量中，不得提交到 GitHub。
