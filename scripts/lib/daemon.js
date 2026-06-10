"use strict";

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

function startDaemon(projectRoot, sessionId, options = {}) {
  const pidPath = path.join(projectRoot, ".harness", "daemon.pid");
  const harnessDir = path.dirname(pidPath);

  if (!fs.existsSync(harnessDir)) {
    fs.mkdirSync(harnessDir, { recursive: true });
  }

  if (fs.existsSync(pidPath)) {
    const pid = parseInt(fs.readFileSync(pidPath, "utf8"));
    if (isProcessRunning(pid)) {
      return { success: false, error: "Daemon already running", pid };
    }
  }

  if (options.test) {
    fs.writeFileSync(pidPath, process.pid.toString());
    return { success: true, pid: process.pid };
  }

  const child = spawn(process.execPath, [
    path.join(__dirname, "../harness.js"),
    "session", "continue", "--session-id", sessionId, "--mode", "autonomous"
  ], {
    detached: true,
    stdio: "ignore",
    cwd: projectRoot
  });

  child.unref();
  fs.writeFileSync(pidPath, child.pid.toString());

  return { success: true, pid: child.pid };
}

function stopDaemon(projectRoot, options = {}) {
  const pidPath = path.join(projectRoot, ".harness", "daemon.pid");

  if (!fs.existsSync(pidPath)) {
    return { success: false, error: "No daemon running" };
  }

  const pid = parseInt(fs.readFileSync(pidPath, "utf8"));

  if (!isProcessRunning(pid)) {
    fs.unlinkSync(pidPath);
    return { success: false, error: "Daemon not running" };
  }

  if (options.test) {
    // In test mode, just remove the PID file without killing the process
    fs.unlinkSync(pidPath);
    return { success: true };
  }

  try {
    process.kill(pid, "SIGTERM");
    fs.unlinkSync(pidPath);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function getDaemonStatus(projectRoot) {
  const pidPath = path.join(projectRoot, ".harness", "daemon.pid");

  if (!fs.existsSync(pidPath)) {
    return { running: false };
  }

  const pid = parseInt(fs.readFileSync(pidPath, "utf8"));
  const running = isProcessRunning(pid);

  if (!running) {
    fs.unlinkSync(pidPath);
  }

  return { running, pid: running ? pid : null };
}

function isProcessRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

module.exports = { startDaemon, stopDaemon, getDaemonStatus };
