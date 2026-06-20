# Phase C Beta User Guide

## Welcome to Amber Protocol Web Viewer

This guide will help you get started with the Amber Protocol Web Viewer.

## Quick Start

### 1. Access the Application
Navigate to `http://localhost:3000` (or your deployed URL)

### 2. View Sessions
- Click **Sessions** in the navigation bar
- Browse active and completed sessions
- Click on any session to view details

### 3. Explore Routes
- Click **Routes** in the navigation bar
- Routes are organized by category
- Click on a route to see full details

### 4. Monitor Gates
- Click **Gates** in the navigation bar
- Filter by status: Pending, Approved, Rejected
- View gate details and decisions

### 5. Customize Settings
- Click **Settings** in the navigation bar
- Toggle auto-refresh
- Adjust refresh interval
- Enable/disable notifications

### 6. Toggle Theme
- Click the theme toggle button in the top-right
- Switch between light and dark mode
- Theme preference is saved automatically

## Key Features

### Real-time Updates
- Session status updates automatically
- Connection indicator shows health
- SSE (Server-Sent Events) for live data

### Session Controls
- **Start**: Begin a new session
- **Pause**: Temporarily pause execution
- **Resume**: Continue paused session
- **Abort**: Stop with confirmation

### Timeline Viewer
- Virtual scrolling for performance
- Filter events by type
- Search within events
- Expandable event details

### Performance
- Smart caching (5-minute staleTime)
- 80% reduction in API calls
- Loading skeletons for better UX
- Error boundaries for graceful failures

## Troubleshooting

### Connection Issues
If you see "Disconnected", the SSE connection was lost. It will automatically reconnect with exponential backoff.

### No Data Showing
Ensure the Amber Protocol backend is running and accessible. Check the browser console for errors.

### Dark Mode Not Persisting
Clear browser cache and try again. Theme uses localStorage.

## Feedback

For issues or feature requests, please file an issue in the repository.

**Version:** Beta 1.0  
**Last Updated:** 2026-06-12
