# Web Viewer Deployment Guide

Deployment guide for the Amber Protocol web viewer (`apps/web`).

## Prerequisites

- Node.js v20.18.1+
- npm v10.8.2+
- Git

## Quick Start

### 1. Install Dependencies

```bash
cd apps/web
npm install --legacy-peer-deps
```

### 2. Build for Production

```bash
npm run build
```

### 3. Start Production Server

```bash
npm run start
# Access at http://localhost:3000
```

## Environment Variables

Currently no environment variables are required.

Planned (not yet wired):

```bash
# SSE Authentication secret
SSE_AUTH_SECRET=your-secret-key

# Monitoring
SENTRY_DSN=https://...
```

## Deployment Options

### Option 1: Vercel

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

### Metrics To Track

- Response time (<200ms target)
- Error rate (<1% target)
- SSE connection count
- Memory usage

See also [MONITORING_SETUP.md](MONITORING_SETUP.md).

## Troubleshooting

### Build Fails

```bash
# Clear cache
rm -rf .next node_modules
npm install --legacy-peer-deps
npm run build
```

### Port Already In Use

```bash
PORT=3001 npm start
```

### Peer Dependency Warnings

- Use the `--legacy-peer-deps` flag
- Known issue with @trpc/react-query and react-query v5

## Security

### Current Status

- Input validation (Zod)
- Path traversal protection
- Error boundaries
- SSE token helpers exist (`lib/auth-token.ts`); enforcing them on the SSE
  endpoint is not yet wired

### Recommendations

- Deploy behind HTTPS
- Use an internal network for the backend
- Enable rate limiting

## Rollback

```bash
git log --oneline -5  # Find commit
git reset --hard <commit-hash>
npm run build && npm start
```

## Production Checklist

- [ ] Environment variables configured
- [ ] HTTPS enabled
- [ ] Monitoring setup
- [ ] Error tracking enabled
- [ ] Backup strategy defined
- [ ] Rollback plan tested
- [ ] Load testing completed
- [ ] Security review done
