# Monitoring Setup Guide

## Error Tracking

### Sentry Integration (Recommended)

```bash
npm install @sentry/nextjs
```

**apps/web/sentry.client.config.ts:**
```typescript
import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 1.0,
  environment: process.env.NODE_ENV,
});
```

**Environment Variables:**
```
NEXT_PUBLIC_SENTRY_DSN=https://your-key@sentry.io/project-id
```

## Performance Monitoring

### Web Vitals Tracking

```typescript
// apps/web/app/layout.tsx
import { reportWebVitals } from 'next/web-vitals';

export function reportWebVitals(metric) {
  console.log(metric);
  // Send to analytics
}
```

### Metrics to Track
- First Contentful Paint (FCP)
- Largest Contentful Paint (LCP)
- Time to Interactive (TTI)
- Cumulative Layout Shift (CLS)

## Health Check Endpoint

```typescript
// apps/web/app/api/health/route.ts
export async function GET() {
  return Response.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '1.0.0-beta',
  });
}
```

## Logging

Current: Console-based  
Production: Consider Winston or Pino

```typescript
import { logError, logWarning } from '@/lib/error-logger';

// Usage
try {
  // code
} catch (error) {
  logError(error, { component: 'MyComponent', action: 'fetchData' });
}
```

## Uptime Monitoring

**Recommended Services:**
- UptimeRobot (free tier)
- Pingdom
- Better Uptime

**Endpoints to Monitor:**
- `GET /` - Main page
- `GET /sessions` - Sessions page
- `GET /api/health` - Health check

## Alerts

**Critical Alerts:**
- Error rate >1%
- Response time >2s
- Uptime <99%

**Warning Alerts:**
- Error rate >0.5%
- Response time >1s
- Memory usage >80%

## Dashboard

**Key Metrics:**
- Requests per minute
- Average response time
- Error rate (%)
- Active SSE connections
- Memory usage

**Tools:**
- Vercel Analytics
- Sentry Performance
- Custom dashboard (Grafana)

## Implementation Status

- ✅ Error logger utility
- ✅ ErrorBoundary integration
- 📋 Sentry integration (Phase D)
- 📋 Health check endpoint (Phase D)
- 📋 Performance tracking (Phase D)

## Next Steps

1. Add Sentry integration
2. Create health check endpoint
3. Set up uptime monitoring
4. Configure alerting rules
5. Build monitoring dashboard
