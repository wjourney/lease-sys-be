# SUPREME BAY 租赁管理系统 · 后端

NestJS + TypeScript + Prisma + MySQL 应用。提供真实认证、权限、持久化、资金流程、私有资料和 PDF 接口。

## 启动

需要 Node.js 22、pnpm 10、已启动的 Docker Desktop。本机 Chrome 用于生成 PDF。

```bash
cd /Users/wenwen/www/learn/lease-sys-be
pnpm install
cp .env.example .env # 已有 .env 时保留原文件
pnpm db:up
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm dev
```

API：http://127.0.0.1:3001/api/v1 。Swagger：http://127.0.0.1:3001/api/docs 。健康检查：`GET /api/v1/health`。

本地 Compose 使用 MySQL 5.7，端口 `53306`，测试库 `lease_test`。生产环境连接服务器已有的 MySQL，使用独立的 `lease_sys` 数据库和账号。迁移有 12 张业务表，另有 Prisma 自身的迁移记录。不要对有业务数据的数据库执行 `migrate reset`。

开发种子只在空库创建一个 `admin` 超级管理员账号，不创建项目、订单或其他演示数据。密码由 `SEED_PASSWORD` 配置（示例环境为 `ChangeMe123!`），生产环境禁止运行该种子。集成测试的样例数据只在独立的 `lease_test` 库临时创建，测试结束后清除。

## 表结构

| 表              | 内容                                                      |
| --------------- | --------------------------------------------------------- |
| users           | 个人登录账号、固定五角色、所属销售公司                    |
| sales_companies | 销售公司；分行与职位在 JSON 配置内                        |
| projects        | 项目及展示配置                                            |
| units           | 项目下具体单位，单位类型引用系统字典                      |
| orders          | 订单、租客、租期、交还和押金处理                          |
| incomes         | 应收 RECEIVABLE 与实收 RECEIPT 同表，parent_id 只允许一层 |
| expenses        | 单笔应付及付款结果；佣金分次支付各保存一行                |
| commissions     | 关联订单的月度/年度佣金                                   |
| invoices        | 关联已确认实收，保留重开前发票                            |
| materials       | 文件/正文、业务归属和版本；归属字段必须且只能选一项       |
| fund_accounts   | 收付款账户                                                |
| system_settings | 单位类型和公共配置                                        |

准确字段见 `prisma/schema.prisma`；外键和唯一索引见 `prisma/migrations/202610010001_mysql_initial/migration.sql`。为精简 Prisma 定义，关系以标量 ID 表达，数据库外键由迁移 SQL 明确创建。MySQL 5.7 不执行 CHECK 约束，租期重叠由 API 内的单位行锁和校验防止，因此不要直接写入业务表。

所有业务记录自带 operationLogs JSON，只记录 CREATE/UPDATE/DELETE，保留操作人、时间、变更前后值、原因。修改使用事务锁和 revision，删除为软删除。没有独立账单、收款、附件、订单变更或操作日志表。

## 代码组织

```text
src/
  main.ts                       # 仅负责启动 HTTP 应用
  app.module.ts                 # 显式组合各业务 Module
  config/swagger.ts             # OpenAPI 配置
  database/
    database.module.ts
    prisma.service.ts
  common/
    auth/                       # 权限、数据范围、密码工具、角色类型
    database/                   # 事务锁、行内操作记录
    filters/                    # 全局异常处理
    resources/                  # 通用分页、查询和 CRUD 基类
    storage/                    # 私有磁盘、PDF 渲染
    validation/                 # 可复用字段校验
  modules/
    auth/                       # 登录、会话；controller/service/guard/module
    users/
    sales-companies/
    projects/
    units/
    orders/                     # 订单生命周期、押金结算、合同各自分 service
    incomes/                    # 应收、收款核对、账期、余额各自分 service
    expenses/
    commissions/
    invoices/                   # 生成、发送、重开各自分 service
    materials/
    fund-accounts/
    settings/
    jobs/                       # 周期出账、后台任务生命周期
    health/
```

每个业务目录包含 `<业务>.module.ts`、`<业务>.controller.ts`、`<业务>.service.ts`；有创建输入的模块使用 `dto/<业务>.schema.ts` 管理 Zod 校验及输入类型。Controller 负责 HTTP 参数与响应，Service 负责业务校验、权限和事务。复杂流程拆为同目录下的专用 service；公共层仅保留跨模块复用的基础能力。

通过 Module 的 imports/exports 显式注入依赖，不使用全局业务容器或循环模块引用。定时任务通过 Nest 生命周期启动和停止，命令行任务使用同一应用上下文。新增业务应在所属模块完成，不往通用 CRUD 基类加入成组业务规则。

金额使用 Decimal 和数据库 NUMERIC，确认收款及付款在事务内更新。重复收款使用 sourceKey 防重；待确认收款占用可收余额，避免并发超收。确认首期所需租金与押金后订单进入租赁状态。租期到期或退租不会自动代表实物交还，交还操作才释放占用。

## 环境与文件

`.env` 被 Git 忽略。`DATABASE_URL`、`JWT_SECRET`、`APP_ORIGIN` 为必需配置。生产使用独立数据库账号、随机 JWT 密钥、实际 HTTPS 来源，并设置 `NODE_ENV=production`（Cookie 启用 Secure）。`HOST` 默认 127.0.0.1；需容器或网络监听时显式设置。

`UPLOAD_DIR` 默认 `./uploads`，私有下载经权限接口校验。支持 PDF、PNG、JPEG、WebP、MP4，单文件上限 30 MB。需随数据库一起持久化、备份；当前实现为本地磁盘存储，尚未接入对象存储。

`CHROME_EXECUTABLE` 默认示例指向 macOS Chrome。Linux 部署需安装可运行的 Chromium，并配置路径及中文字体。发票生成失败最多自动尝试五次，可手动重试；中断任务在十分钟后恢复。合同按项目文字模板和业务快照生成，不提供 DOCX 任意模板引擎。

SMTP 需设置 `SMTP_HOST`、`SMTP_PORT`、`SMTP_USER`、`SMTP_PASSWORD`、`SMTP_FROM`。未配置不发送邮件。模糊失败标记 UNKNOWN，财务核验后决定重试，避免自动重复投递。实际邮件投递需使用你的 SMTP 环境验证。

## 测试与构建

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm start
```

`pnpm test` 只重建本机 `lease_test` 数据库，在 3002 启动 API 后执行测试并关闭测试 API，不重建 `lease`。测试覆盖角色隔离、CSRF、重复与并发收款、确认及发票、佣金分次付款、真实 PDF、退租退款、文件版本和操作记录。

`pnpm test:serve` 同样重建 `lease_test`，然后保持 3002 运行，供前端 `pnpm test:e2e` 使用。运行前需空出 3002；结束按 Ctrl+C。前后端测试可反复运行。

手动执行周期任务：`pnpm jobs`。服务启动后每分钟自动检查，无需 Redis 或独立队列。部署时先 `pnpm db:migrate`，再 `pnpm build && pnpm start`，使用进程守护和反向代理。当前未部署公网服务。
