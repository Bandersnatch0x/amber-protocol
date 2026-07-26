# Vite 迁移评审报告

## 执行概要

当前 `feat/vite-migration` 分支将 Next.js 迁移到 Vite + React Router，但存在多个**阻塞性问题**和设计缺陷。

**状态：** ⛔ 无法运行 - 需要立即修复

---

## 🔴 关键问题（阻塞性）

### 1. Vite 8.0.16 与 Node.js 版本不兼容

**问题：**
```
You are using Node.js 20.18.1. 
Vite requires Node.js version 20.19+ or 22.12+
```

**影响：** 前端完全无法启动

**原因分析：**
- Vite 8.0 是一个**非常新的版本**（可能是 alpha/beta）
- 需要最新的 Node.js 版本
- package.json 中指定 `"vite": "^8.0.16"` 过于激进

**解决方案：**
```json
// 选项 1：降级到稳定版 Vite（推荐）
"vite": "^5.4.0"  // 当前稳定版

// 选项 2：升级 Node.js
// 升级到 Node.js 22.12+ 或 20.19+
```

---

### 2. ERR_REQUIRE_ESM - TypeScript 配置问题

**错误信息：**
```
Error [ERR_REQUIRE_ESM]: require() of ES Module 
D:\code_space\coding-harness\apps\web\node_modules\vite\dist\node\index.js 
from D:\code_space\coding-harness\apps\web\vite.config.ts not supported.
```

**根本原因：**
- `tsconfig.app.json` 使用 `"jsx": "preserve"` 和 `"module": "esnext"`
- 但 Vite 配置文件需要 ES Module 语法
- TypeScript 配置与 Vite 8.0 的 ESM 要求冲突

**解决方案：**

1. **修改 `tsconfig.node.json`**（用于 Vite 配置）：
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "isolatedModules": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "types": ["node"],
    "allowSyntheticDefaultImports": true
  },
  "include": ["vite.config.ts", "vitest.config.ts", "server/**/*.ts"]
}
```

2. **修改 `tsconfig.app.json`**：
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["dom", "dom.iterable", "ES2020"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",  // 改为 react-jsx
    // ... 其他配置保持
  }
}
```

---

### 3. React Query 版本降级问题

**问题：**
```json
"@tanstack/react-query": "^4.44.0"  // 降级到 v4
```

**影响：**
- v4 是旧版本，缺少 v5 的性能优化和新特性
- `cacheTime` 在 v5 中已重命名为 `gcTime`
- 降级会导致代码与最新的 TanStack 生态不兼容

**当前代码中的问题：**
```typescript
// src/lib/trpc-provider.tsx
const [queryClient] = useState(() => new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      cacheTime: 10 * 60 * 1000,  // ❌ v5 中已改为 gcTime
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
}));
```

**解决方案：**
```json
// 升级到 v5（推荐）
"@tanstack/react-query": "^5.28.0"
```

```typescript
// 修改代码
const [queryClient] = useState(() => new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      gcTime: 10 * 60 * 1000,  // ✅ v5 使用 gcTime
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
}));
```

---

## 🟡 设计问题（需要重新考虑）

### 4. 删除了 Next.js 但未完全迁移路由

**问题分析：**

删除的 Next.js 文件：
- `app/api/sessions/[sessionId]/events/route.ts` - SSE API 路由
- `app/api/trpc/[trpc]/route.ts` - tRPC API 路由
- `app/` 目录下所有页面组件

创建的 Vite 路由：
- `src/routes/*.tsx` - 使用 TanStack Router

**架构不一致：**
- **后端：** 使用 Express + tRPC（在 `server/` 目录）
- **前端：** 使用 Vite + TanStack Router
- **问题：** SSE 和 tRPC 路由从 Next.js API Routes 迁移到 Express，但缺少完整性测试

**潜在问题：**
1. SSE 端点 `/api/sessions/:sessionId/events` 在 Express 中实现，但前端代码可能仍引用旧路径
2. tRPC 配置需要验证是否与 Express 适配器正确集成
3. 缺少 API 路由的迁移文档

---

### 5. UI 框架选择不明确

**观察：**
```typescript
// src/routes/__root.tsx
import { ThemeProvider } from '@/lib/theme-provider';
import { ThemeToggle } from '@/components/ThemeToggle';
```

```typescript
// src/components/ThemeToggle.tsx
import { useTheme } from 'next-themes';  // ⚠️ 仍然使用 next-themes
```

**问题：**
- 删除了 Next.js，但主题切换仍依赖 `next-themes` 包
- `next-themes` 虽然可以在非 Next.js 环境使用，但不是最佳选择

**建议：**

**选项 A：保持 next-themes**（快速方案）
- `next-themes` 实际上是独立的，不强依赖 Next.js
- 可以继续使用，但需要在文档中说明

**选项 B：切换到原生实现**（推荐）
```typescript
// lib/theme-provider.tsx
import { createContext, useContext, useEffect, useState } from 'react';

type Theme = 'light' | 'dark' | 'system';

const ThemeContext = createContext<{
  theme: Theme;
  setTheme: (theme: Theme) => void;
}>({ theme: 'system', setTheme: () => {} });

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>('system');
  
  useEffect(() => {
    const stored = localStorage.getItem('theme') as Theme;
    if (stored) setTheme(stored);
  }, []);
  
  useEffect(() => {
    const root = document.documentElement;
    const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const isDark = theme === 'dark' || (theme === 'system' && systemDark);
    
    root.classList.toggle('dark', isDark);
    localStorage.setItem('theme', theme);
  }, [theme]);
  
  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
```

---

### 6. 缺少组件库迁移策略

**删除的文件分析：**
```
D apps/web/components/ErrorBoundary.tsx
D apps/web/components/SessionSkeleton.tsx
D apps/web/components/ThemeToggle.tsx
D apps/web/components/session/ConfirmAbortDialog.tsx
D apps/web/components/session/ConnectionIndicator.tsx
D apps/web/components/session/SessionControls.tsx
...
```

**新位置：**
```
src/components/ErrorBoundary.tsx
src/components/SessionSkeleton.tsx
src/components/ThemeToggle.tsx
...
```

**问题：**
- 组件只是简单移动，未优化
- 未利用 Vite 的新特性（如 HMR、动态导入优化）
- 缺少代码分割策略

**建议优化：**
```typescript
// src/routes/sessions.$id.tsx - 使用懒加载
import { lazy, Suspense } from 'react';

const VirtualTimeline = lazy(() => 
  import('@/components/session/VirtualTimeline')
);

export function SessionDetailPage() {
  return (
    <Suspense fallback={<SessionSkeleton />}>
      <VirtualTimeline />
    </Suspense>
  );
}
```

---

## 🟢 优化建议

### 7. Tailwind 配置可以简化

**当前：**
```javascript
// tailwind.config.js - 59 行
module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: { /* ... */ },
      animation: { /* ... */ },
    },
  },
  plugins: [],
};
```

**建议：**
```javascript
// tailwind.config.js - 使用 Vite 推荐配置
export default {  // ✅ 使用 ESM
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        primary: 'var(--color-accent)',
        surface: 'var(--color-surface)',
      },
    },
  },
};
```

---

### 8. 构建配置不完整

**当前 package.json：**
```json
{
  "scripts": {
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview"
  }
}
```

**问题：**
- 缺少环境变量配置
- 缺少生产构建优化
- 缺少构建产物分析

**建议添加：**
```json
{
  "scripts": {
    "build": "tsc --noEmit && vite build",
    "build:analyze": "vite-bundle-visualizer",
    "preview": "vite preview",
    "type-check": "tsc --noEmit",
    "lint": "eslint src --ext .ts,.tsx"
  }
}
```

**Vite 配置优化：**
```typescript
// vite.config.ts
export default defineConfig({
  plugins: [TanStackRouterVite(), react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@server': path.resolve(__dirname, './server'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  build: {
    target: 'esnext',
    minify: 'esbuild',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
          router: ['@tanstack/react-router'],
          trpc: ['@trpc/client', '@trpc/react-query'],
        },
      },
    },
  },
  optimizeDeps: {
    include: ['react', 'react-dom', '@tanstack/react-query'],
  },
});
```

---

## 📊 变更统计

```
54 files changed, 6152 insertions(+), 8832 deletions(-)
```

**分析：**
- **净减少 2680 行代码** - 好的信号（简化了架构）
- **删除了 36 个文件** - Next.js 特定文件
- **修改了 18 个文件** - 主要是配置和测试

---

## 🚦 推荐的修复顺序

### Phase 1: 紧急修复（阻塞性问题）

1. **降级 Vite 到稳定版本**
```bash
cd apps/web
npm install vite@^5.4.0 --save-dev
```

2. **修复 TypeScript 配置**
   - 更新 `tsconfig.node.json`
   - 更新 `tsconfig.app.json`

3. **升级 React Query 到 v5**
```bash
npm install @tanstack/react-query@^5.28.0
```

4. **修复 trpc-provider.tsx**
   - `cacheTime` → `gcTime`

### Phase 2: 验证功能

5. **测试所有 API 端点**
   - 验证 SSE 连接
   - 验证 tRPC 调用
   - 检查路由是否正常工作

6. **运行测试套件**
```bash
npm test
npm run test:e2e
```

### Phase 3: 优化（非阻塞）

7. **优化组件加载**
   - 添加懒加载
   - 实现代码分割

8. **替换 next-themes**（可选）
   - 实现原生主题切换

9. **添加构建优化**
   - 配置 chunk splitting
   - 添加构建分析工具

---

## 📝 迁移检查清单

### ✅ 已完成
- [x] 删除 Next.js 依赖
- [x] 创建 Vite 配置
- [x] 设置 TanStack Router
- [x] 移动组件到 src/ 目录
- [x] 配置 Tailwind CSS
- [x] 设置 Express 后端
- [x] 配置 tRPC

### ⛔ 阻塞问题
- [ ] 修复 Vite 版本不兼容
- [ ] 解决 ERR_REQUIRE_ESM 错误
- [ ] 升级 React Query 到 v5

### ⚠️ 需要验证
- [ ] SSE 端点是否正常工作
- [ ] tRPC 调用是否正确
- [ ] 所有路由是否可访问
- [ ] 主题切换是否工作
- [ ] 深色模式是否正常
- [ ] 所有单元测试通过
- [ ] E2E 测试通过

### 🎯 优化建议
- [ ] 实现代码分割
- [ ] 添加懒加载
- [ ] 优化构建配置
- [ ] 添加性能监控
- [ ] 替换 next-themes（可选）

---

## 💡 UI 效果相关问题

你提到"当前的UI效果并不是我想要的"，但具体问题需要更多信息：

### 可能的问题：

1. **布局问题**
   - Tailwind 类名可能需要调整
   - 响应式设计可能有问题

2. **样式不一致**
   - CSS 变量可能未正确应用
   - 深色模式样式可能有问题

3. **组件渲染问题**
   - TanStack Router 路由可能未正确配置
   - 组件可能未正确导入

### 诊断建议：

**请提供以下信息：**
1. 期望的 UI 效果（截图或描述）
2. 当前的 UI 效果（如果能启动的话）
3. 具体哪些页面/组件的效果不对

**临时修复方案：**
在修复 Vite 配置后，我可以帮你：
1. 调整 Tailwind 样式
2. 修复布局问题
3. 优化组件设计

---

## 🔧 立即可执行的修复命令

```bash
# 1. 回到项目根目录
cd D:/code_space/coding-harness

# 2. 进入 web 应用目录
cd apps/web

# 3. 降级 Vite 到稳定版本
npm install vite@^5.4.0 --legacy-peer-deps

# 4. 升级 React Query 到 v5
npm install @tanstack/react-query@^5.28.0 --legacy-peer-deps

# 5. 重新安装依赖
npm install --legacy-peer-deps

# 6. 尝试启动
npm run dev
```

执行完这些命令后，再告诉我具体的 UI 问题和任何错误信息。

---

## 📚 参考资源

- [Vite 5.x 官方文档](https://vitejs.dev/)
- [TanStack Router 文档](https://tanstack.com/router/latest)
- [TanStack Query v5 迁移指南](https://tanstack.com/query/latest/docs/react/guides/migrating-to-v5)
- [Vite 配置参考](https://vitejs.dev/config/)

---

**总结：** 当前迁移有明确的技术路径，但需要先解决 3 个阻塞性问题才能继续。修复后我可以帮助优化 UI 和性能。
