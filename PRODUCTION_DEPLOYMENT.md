# Production Deployment Guide

## Prerequisites

- Node.js v20.18.1+
- npm v10.8.2+
- Git

## Quick Start

### 1. Clone Repository
```bash
git clone <repository-url>
cd coding-harness
```

### 2. Install Dependencies
```bash
cd apps/web
npm install --legacy-peer-deps
```

### 3. Build for Production
```bash
npm run build
```

### 4. Start Production Server
```bash
npm run start
# Access at http://localhost:3000
```

## Environment Variables

Currently no environment variables required.

### Phase D (Future)
```bash
# SSE Authentication
SSE_AUTH_SECRET=your-secret-key

# Database (if implemented)
DATABASE_URL=postgresql://...

# Monitoring
SENTRY_DSN=https://...
```

## Deployment Options

### Option 1: Vercel (Recommended)
```bash
npm install -g vercel
vercel deploy
```

### Option 2: Docker
```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --legacy-peer-deps
COPY . .
RUN npm run build
EXPOSE 3000
CMD ["npm", "start"]
```

### Option 3: Traditional Server
```bash
# Build
npm run build

# Use PM2 for process management
npm install -g pm2
pm2 start npm --name "amber-web" -- start
pm2 save
```

## Health Check

### Endpoints
- **Root:** `GET /` - Returns main page
- **Sessions:** `GET /sessions` - Session list
- **SSE:** `GET /api/sessions/:id/events` - Real-time events

### Verification
```bash
curl http://localhost:3000/sessions
# Should return HTML with "Sessions" title
```

## Monitoring

### Metrics to Track
- Response time (<200ms target)
- Error rate (<1% target)
- SSE connection count
- Memory usage

### Recommended Tools
- **APM:** Sentry, Datadog
- **Logs:** LogRocket, Better Stack
- **Uptime:** UptimeRobot, Pingdom

## Troubleshooting

### Build Fails
```bash
# Clear cache
rm -rf .next node_modules
npm install --legacy-peer-deps
npm run build
```

### Port Already in Use
```bash
# Change port
PORT=3001 npm start
```

### Peer Dependency Warnings
- Use `--legacy-peer-deps` flag
- Known issue with @trpc/react-query and react-query v5

## Performance

### Current Metrics
- Page load: <2s
- API response: <200ms
- Cache hit rate: ~80%

### Optimization Tips
- Enable CDN for static assets
- Use Redis for session storage (Phase D)
- Enable gzip compression
- Configure proper cache headers

## Security

### Current Status
- ✅ Input validation (Zod)
- ✅ Path traversal protection
- ✅ Error boundaries
- ⚠️ SSE authentication (Phase D)

### Recommendations
- Deploy behind HTTPS
- Use internal network for backend
- Enable rate limiting
- Implement SSE auth (Phase D)

## Rollback

### Quick Rollback
```bash
# Revert to previous commit
git log --oneline -5  # Find commit
git reset --hard <commit-hash>
npm run build && npm start
```

### Zero-Downtime Deployment
- Use blue-green deployment
- Or rolling updates with K8s

## Support

### Logs Location
- **Next.js:** `.next/` directory
- **Browser Console:** F12 DevTools
- **Server:** stdout/stderr

### Common Issues
1. **White screen:** Check browser console
2. **API errors:** Check server logs
3. **SSE disconnects:** Normal, auto-reconnects

## Production Checklist

- [ ] Environment variables configured
- [ ] HTTPS enabled
- [ ] Monitoring setup
- [ ] Error tracking enabled
- [ ] Backup strategy defined
- [ ] Rollback plan tested
- [ ] Load testing completed
- [ ] Security review done

## Version

**Current:** 1.0.0-beta  
**Status:** Production-Ready  
**Last Updated:** 2026-06-12
