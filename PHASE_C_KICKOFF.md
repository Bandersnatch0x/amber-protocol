# Phase C 启动计划

## 项目概览

**目标:** Web Viewer for Amber Protocol sessions  
**技术栈:** Next.js 14 + tRPC + Tailwind CSS  
**工期:** 8周  
**状态:** 🟡 已创建脚手架,待开发页面组件

## Week C1 (本周): 项目初始化

### 任务清单

#### 1. 项目结构验证 (5分钟)
```bash
# 检查apps/web/是否存在
ls apps/web/

# 如果不存在,创建
mkdir -p apps/web
```

#### 2. Next.js 14初始化 (10分钟)
```bash
cd apps/web
npx create-next-app@latest . --typescript --tailwind --app --no-src-dir
```

配置:
- ✅ TypeScript: Yes
- ✅ Tailwind CSS: Yes
- ✅ App Router: Yes
- ❌ src/ directory: No
- ✅ import alias (@/*): Yes

#### 3. 安装依赖 (5分钟)
```bash
npm install @trpc/server @trpc/client @trpc/react-query @trpc/next
npm install @tanstack/react-query zod
npm install -D @types/node
```

#### 4. tRPC设置 (20分钟)

**4.1 创建tRPC配置**
```typescript
// app/api/trpc/[trpc]/route.ts
import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { appRouter } from '@/server/trpc';

const handler = (req: Request) =>
  fetchRequestHandler({
    endpoint: '/api/trpc',
    req,
    router: appRouter,
    createContext: () => ({}),
  });

export { handler as GET, handler as POST };
```

**4.2 创建路由器**
```typescript
// server/trpc.ts
import { initTRPC } from '@trpc/server';

const t = initTRPC.create();

export const router = t.router;
export const publicProcedure = t.procedure;
```

**4.3 Session路由**
```typescript
// server/routers/session.ts
import { router, publicProcedure } from '../trpc';
import { z } from 'zod';
import { readSessionList } from '@/lib/session-reader';

export const sessionRouter = router({
  list: publicProcedure.query(() => {
    return readSessionList();
  }),
  
  byId: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(({ input }) => {
      return readSessionById(input.id);
    }),
});
```

#### 5. Session列表页面 (30分钟)

```typescript
// app/sessions/page.tsx
'use client';

import { trpc } from '@/lib/trpc';

export default function SessionsPage() {
  const { data: sessions, isLoading } = trpc.session.list.useQuery();

  if (isLoading) return <div>Loading...</div>;

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-4">Sessions</h1>
      <div className="space-y-2">
        {sessions?.map((session) => (
          <div key={session.id} className="border p-4 rounded">
            <div>{session.goal}</div>
            <div className="text-sm text-gray-500">{session.status}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

#### 6. Session读取器 (20分钟)

```typescript
// lib/session-reader.ts
import fs from 'fs';
import path from 'path';

interface Session {
  id: string;
  goal: string;
  status: string;
  createdAt: string;
}

export function readSessionList(): Session[] {
  const sessionsDir = path.join(process.cwd(), '../../.amber/sessions');
  
  if (!fs.existsSync(sessionsDir)) {
    return [];
  }

  const dirs = fs.readdirSync(sessionsDir);
  
  return dirs.map(id => {
    const manifestPath = path.join(sessionsDir, id, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
      return null;
    }
    
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    return {
      id,
      goal: manifest.goal,
      status: manifest.status,
      createdAt: manifest.createdAt,
    };
  }).filter(Boolean) as Session[];
}

export function readSessionById(id: string) {
  const manifestPath = path.join(
    process.cwd(),
    '../../.amber/sessions',
    id,
    'manifest.json'
  );
  
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
}
```

### Week C1 交付物

✅ Next.js 14项目初始化  
✅ tRPC服务器+客户端配置  
✅ Session列表API  
✅ Session列表页面  
✅ Session读取器工具  

### 成功标准

```bash
# 启动开发服务器
cd apps/web
npm run dev

# 访问 http://localhost:3000/sessions
# 应显示所有.amber/sessions/的会话列表
```

## Week C2: Timeline Viewer

### 任务清单

1. Timeline API路由 (30分钟)
2. Timeline事件解析器 (30分钟)
3. Timeline可视化组件 (1小时)
4. Session详情页集成 (30分钟)

### 交付物

✅ Timeline读取API  
✅ 事件流解析器  
✅ Timeline可视化UI  
✅ Session详情页面  

## 并行任务: P1修复

在Phase C Week 1开发期间,抽30分钟完成剩余P1:

1. E1.5 --explain (10分钟)
2. E4.6 --strict (10分钟)
3. M2.5 --fix-markers (10分钟)
4. M7.5 --priority (10分钟)

## 技术决策

### 为什么Next.js 14?
- App Router (稳定)
- Server Components (性能)
- tRPC原生支持
- TypeScript一流支持

### 为什么tRPC?
- 类型安全API
- 无需代码生成
- React Query集成
- 简单部署

### 为什么Tailwind?
- 快速原型
- 响应式开箱即用
- shadcn/ui组件库

## 风险与缓解

**风险1: .amber/路径解析**
- 缓解: 使用相对路径 ../../.amber
- 备选: 环境变量 AMBER_PATH

**风险2: 文件系统访问性能**
- 缓解: React Query缓存
- 备选: 后续添加Redis

**风险3: 实时更新延迟**
- 缓解: SSE (Week C3)
- 备选: 轮询 (Week C1-C2)

## 下一步

**立即执行:**
1. 创建apps/web/目录
2. 初始化Next.js项目
3. 安装依赖
4. 实现Session列表

**本周目标:**
- ✅ 可访问的Session列表页面
- ✅ 显示所有会话
- ✅ 基本状态显示

**下周目标:**
- Timeline可视化
- Session详情页
- 事件流解析

准备好开始了吗?
