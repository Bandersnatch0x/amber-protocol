# Phase C Week 2 实施计划

## 目标概述

Week C1已完成Session基础,Week C2目标:
1. **Timeline可视化增强**
2. **Route浏览器**
3. **主题系统**
4. **性能优化**

## 任务清单

### 1. Timeline增强可视化 (2小时)

**当前状态:** 基础Timeline已实现  
**目标:** 事件类型图标、时间轴、过滤器

**实现:**
- [ ] Timeline事件类型图标
- [ ] 垂直时间轴布局
- [ ] 事件类型过滤器
- [ ] 搜索事件功能

**文件:**
- `app/sessions/[id]/timeline/page.tsx` (增强)
- `components/timeline/EventIcon.tsx` (新建)
- `components/timeline/TimelineFilter.tsx` (新建)

---

### 2. Route浏览器 (1.5小时)

**当前状态:** 占位页面  
**目标:** 完整Route列表和详情

**实现:**
- [ ] Route读取器 (`lib/route-reader.ts`)
- [ ] Route列表页面 (替换占位)
- [ ] Route详情页面
- [ ] Route tRPC路由

**文件:**
- `lib/route-reader.ts` (新建)
- `server/routers/route.ts` (新建)
- `app/routes/page.tsx` (替换)
- `app/routes/[id]/page.tsx` (新建)

---

### 3. 主题系统 (1小时)

**当前状态:** 无主题切换  
**目标:** Dark/Light模式切换

**实现:**
- [ ] 安装next-themes
- [ ] Theme Provider
- [ ] Header主题切换按钮
- [ ] Tailwind dark模式配置

**文件:**
- `lib/theme-provider.tsx` (新建)
- `components/ThemeToggle.tsx` (新建)
- `app/layout.tsx` (更新)
- `tailwind.config.js` (更新)

---

### 4. 性能优化 (30分钟)

**实现:**
- [ ] Timeline虚拟滚动 (react-window)
- [ ] Session列表分页
- [ ] React Query缓存配置
- [ ] 懒加载Timeline

**文件:**
- `app/sessions/[id]/timeline/page.tsx` (虚拟滚动)
- `lib/trpc.ts` (缓存配置)

---

## 最小化实现策略

### Timeline增强 (核心)
```typescript
// EventIcon.tsx - 简单图标映射
const icons = {
  'session-started': '▶️',
  'stage-completed': '✅',
  'error': '❌',
};

// TimelineFilter.tsx - 简单下拉框
<select onChange={e => setFilter(e.target.value)}>
  <option value="">All Events</option>
  <option value="error">Errors Only</option>
</select>
```

### Route浏览器 (核心)
```typescript
// route-reader.ts - 最小实现
export function listRoutes(): Route[] {
  const routesDir = path.join(process.cwd(), '..', '..', 'routes');
  const files = fs.readdirSync(routesDir).filter(f => f.endsWith('.route.json'));
  return files.map(f => JSON.parse(fs.readFileSync(path.join(routesDir, f), 'utf8')));
}
```

### 主题系统 (核心)
```typescript
// ThemeToggle.tsx - 简单按钮
const { theme, setTheme } = useTheme();
<button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
  {theme === 'dark' ? '☀️' : '🌙'}
</button>
```

---

## 执行顺序

### Phase 1: Route浏览器 (优先)
1. route-reader.ts (20分钟)
2. route.ts router (10分钟)
3. routes页面 (30分钟)
4. route详情页 (30分钟)

### Phase 2: 主题系统
1. 安装依赖 (5分钟)
2. Theme Provider (15分钟)
3. 主题切换按钮 (20分钟)
4. Dark模式样式 (20分钟)

### Phase 3: Timeline增强
1. 事件图标 (20分钟)
2. 过滤器组件 (30分钟)
3. 时间轴布局 (40分钟)
4. 搜索功能 (30分钟)

### Phase 4: 性能优化
1. 虚拟滚动 (15分钟)
2. 缓存配置 (15分钟)

**总计: ~5小时**

---

## Week C2 交付物

### 新功能
- ✅ Route列表和详情浏览
- ✅ Dark/Light主题切换
- ✅ Timeline事件过滤
- ✅ Timeline事件图标

### 优化
- ✅ Timeline虚拟滚动 (支持10K+事件)
- ✅ React Query智能缓存
- ✅ 更好的加载状态

### 文件清单
- 8个新文件
- 4个更新文件
- ~400行新代码

---

## 成功标准

1. ✅ 可以浏览所有Route
2. ✅ 可以切换Dark/Light主题
3. ✅ Timeline可以按类型过滤
4. ✅ Timeline加载10K事件<2秒
5. ✅ 所有页面响应式设计
6. ✅ 所有测试通过

---

## 技术决策

### 为什么next-themes?
- 最流行的Next.js主题库
- 自动处理SSR/hydration
- 与Tailwind完美集成

### 为什么react-window?
- 虚拟滚动性能最佳
- 轻量级 (8KB)
- Timeline可能有数千事件

### 为什么最小化实现?
- Week C2重点是功能覆盖
- 可以在Week C3-C4美化
- 先做对,再做好

---

## 开始实施?

准备按Phase 1-4顺序执行,预计5小时完成Week C2所有目标。

开始吗?
