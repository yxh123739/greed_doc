# GTFS 数据迁移至 Supabase — 设计规格

**日期**: 2026-03-31
**阶段**: Phase B（Phase A subway-first scoring 已完成）

## 背景

Phase A 实现了 subway-first transit scoring，GTFS 数据通过 `scripts/preprocess-gtfs.ts` 预处理为 JSON 文件（`public/gtfs_supplemented/index/stop-trips.json`），API 在运行时直接从磁盘读取。

Phase B 目标：将 GTFS 数据迁移到 Supabase 数据库，并提供手动更新脚本从 S3 下载最新数据。

## 数据源

- **仅使用 `gtfs_supplemented`**（S3 URL: `https://rrgtfsfeeds.s3.amazonaws.com/gtfs_supplemented.zip`）
- `gtfs_subway` 与 supplemented 的 routes/stops 完全相同，仅 trip 数量更少，不入库
- supplemented 包含 78 个 calendar 服务、2.4M 条 stop_times，数据更密集准确

## 数据模型

三张表，存放预处理后的聚合结果：

### `gtfs_stops`（496 行）

| 列 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `stop_id` | text | PK | 合并后的站点 ID，如 "120" |
| `stop_name` | text | NOT NULL | 站名 |
| `lat` | numeric | NOT NULL | 纬度 |
| `lng` | numeric | NOT NULL | 经度 |

### `gtfs_routes`

| 列 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `route_id` | text | PK | 如 "A" |
| `route_name` | text | NOT NULL | 显示名 |
| `route_type` | integer | NOT NULL | GTFS route_type（1=subway, 3=bus 等） |

### `gtfs_stop_routes`

| 列 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `stop_id` | text | FK → gtfs_stops | 站点 |
| `route_id` | text | FK → gtfs_routes | 线路 |
| `direction_id` | integer | NOT NULL | 方向 0 或 1 |
| `weekday_trips_min` | integer | NOT NULL | 该方向工作日最小班次数 |
| `weekend_trips_max` | integer | NOT NULL | 该方向周末最大班次数 |

**复合主键**: `(stop_id, route_id, direction_id)`

### RLS 策略

三张表均启用 RLS，添加 `FOR SELECT USING (true)` 策略（anon 可读），写操作仅 service_role。

## 更新策略

- **Truncate + Full Reload** — 每次更新前清空三张表，全量重新写入
- **手动触发** — `pnpm run update-gtfs` 执行更新脚本
- **定时任务推迟** — 后续可用 GitHub Actions cron 实现月度自动更新

## 更新脚本流程

`scripts/update-gtfs.ts`：

1. 从 S3 下载 `gtfs_supplemented.zip`
2. 解压到临时目录
3. 解析 CSV 文件（calendar.txt, routes.txt, trips.txt, stops.txt, stop_times.txt）
4. 复用现有聚合逻辑（`aggregateStopTrips` + `mergeNSPlatforms`）
5. Truncate 三张表（在事务内）
6. 批量 INSERT 到 Supabase
7. 清理临时文件

需要 `SUPABASE_SERVICE_ROLE_KEY` 环境变量用于写入操作。

## API 改造

`app/api/transit/route.ts` 变更：

### 之前

```typescript
// 从磁盘读 JSON
const indexPath = join(process.cwd(), "public/gtfs_supplemented/index/stop-trips.json");
gtfsIndex = JSON.parse(readFileSync(indexPath, "utf-8"));
```

### 之后

```typescript
// 从 Supabase 查询
const { data: stops } = await supabase.from("gtfs_stops").select("*");
const { data: stopRoutes } = await supabase
  .from("gtfs_stop_routes")
  .select("*, gtfs_routes(*)");
// 组装为 StopTripsIndex 格式
```

- **不缓存** — 每次请求查询 Supabase，数据量小（496 stops）延迟可忽略
- 查询结果组装为现有 `StopTripsIndex` 类型，下游 `findNearbyGtfsStops` / `scoreTransit` 逻辑不变

## 文件变更清单

| 文件 | 操作 | 说明 |
|---|---|---|
| `lib/supabase/schema.sql` | 修改 | 添加三张 GTFS 表 + RLS 策略 |
| `lib/supabase/client.ts` | 修改 | 添加 service role client（用于写入） |
| `scripts/update-gtfs.ts` | 新建 | S3 下载 + 解析 + 写入 Supabase |
| `scripts/preprocess-gtfs.ts` | 修改 | 提取可复用的解析/聚合函数供 update-gtfs 调用 |
| `app/api/transit/route.ts` | 修改 | 从 Supabase 读取数据替代磁盘 JSON |
| `public/gtfs_supplemented/index/stop-trips.json` | 删除 | 不再需要 |
| `package.json` | 修改 | 添加 `update-gtfs` script |
| `tests/update-gtfs.test.ts` | 新建 | 更新脚本测试 |

## 不变部分

- `lib/transit-types.ts` — 类型定义不变
- `lib/transit-scoring.ts` — 评分逻辑不变
- `app/benchmark/transit/page.tsx` — 前端不变
- N/S 平台合并逻辑 — 继续在预处理阶段执行

## 依赖

- `@supabase/supabase-js`（已安装）
- `unzipper` 或 `yauzl`（解压 zip，需新增）
