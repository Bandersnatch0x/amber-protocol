"use strict";

const fs = require("fs");
const path = require("path");

class Logger {
  constructor(filePath) {
    this.filePath = filePath;
    this._ensureDir();
  }

  _ensureDir() {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  log(level, message, data = {}) {
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...data
    };

    fs.appendFileSync(this.filePath, JSON.stringify(entry) + "\n", "utf8");
  }

  info(message, data) {
    this.log("info", message, data);
  }

  error(message, data) {
    this.log("error", message, data);
  }

  warn(message, data) {
    this.log("warn", message, data);
  }

  close() {
    // No-op for sync logger; kept for API compatibility
  }
}

function createLogger(filePath) {
  return new Logger(filePath);
}

module.exports = { createLogger };
