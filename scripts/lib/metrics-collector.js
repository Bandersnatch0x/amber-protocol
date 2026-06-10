"use strict";

const fs = require("fs");
const path = require("path");

function collectMetrics(projectRoot, sessionId) {
  const manifestPath = path.join(projectRoot, ".harness", "sessions", sessionId, "manifest.json");

  if (!fs.existsSync(manifestPath)) {
    return null;
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const duration = new Date(manifest.updatedAt) - new Date(manifest.createdAt);

  return {
    sessionId,
    status: manifest.status,
    duration,
    stagesCompleted: (manifest.completedStages || []).length,
    budgetUsed: manifest.budget?.used || 0,
    createdAt: manifest.createdAt
  };
}

function getMetricsSummary(projectRoot) {
  const sessionsDir = path.join(projectRoot, ".harness", "sessions");

  if (!fs.existsSync(sessionsDir)) {
    return { totalSessions: 0, successRate: 0, avgDuration: 0 };
  }

  const sessions = fs.readdirSync(sessionsDir)
    .map(id => collectMetrics(projectRoot, id))
    .filter(m => m !== null);

  if (sessions.length === 0) {
    return { totalSessions: 0, successRate: 0, avgDuration: 0 };
  }

  const completed = sessions.filter(s => s.status === "completed").length;
  const totalDuration = sessions.reduce((sum, s) => sum + s.duration, 0);

  return {
    totalSessions: sessions.length,
    successRate: sessions.length > 0 ? completed / sessions.length : 0,
    avgDuration: sessions.length > 0 ? totalDuration / sessions.length : 0
  };
}

module.exports = { collectMetrics, getMetricsSummary };
