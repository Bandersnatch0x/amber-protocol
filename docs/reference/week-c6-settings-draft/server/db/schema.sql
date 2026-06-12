-- User settings with versioning for optimistic locking
CREATE TABLE IF NOT EXISTS user_settings (
  user_id VARCHAR(255) PRIMARY KEY,
  data JSONB NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_user_settings_updated ON user_settings(updated_at);

-- User preferences (appearance, locale, notifications)
CREATE TABLE IF NOT EXISTS user_preferences (
  user_id VARCHAR(255) PRIMARY KEY,
  appearance JSONB NOT NULL DEFAULT '{"theme":"system","density":"comfortable"}',
  localization JSONB NOT NULL DEFAULT '{"locale":"en","timezone":"UTC"}',
  notifications JSONB NOT NULL DEFAULT '{"email":true,"push":false}',
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Audit log for compliance
CREATE TABLE IF NOT EXISTS audit_log (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL,
  action VARCHAR(50) NOT NULL,
  table_name VARCHAR(50) NOT NULL,
  old_value JSONB,
  new_value JSONB,
  ip_hash VARCHAR(64), -- SHA-256 hashed for GDPR
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_log_user ON audit_log(user_id, created_at DESC);
CREATE INDEX idx_audit_log_table ON audit_log(table_name, created_at DESC);

-- Admin configuration with versioning and optimistic locking
CREATE TABLE IF NOT EXISTS configurations (
  id SERIAL PRIMARY KEY,
  key VARCHAR(255) NOT NULL,
  value JSONB NOT NULL,
  environment VARCHAR(50) NOT NULL DEFAULT 'production',
  version INTEGER NOT NULL DEFAULT 1,
  created_by VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(key, environment)
);

CREATE INDEX idx_config_env ON configurations(environment, key);

-- Config version history for rollback
CREATE TABLE IF NOT EXISTS config_history (
  id SERIAL PRIMARY KEY,
  config_id INTEGER NOT NULL REFERENCES configurations(id) ON DELETE CASCADE,
  key VARCHAR(255) NOT NULL,
  value JSONB NOT NULL,
  version INTEGER NOT NULL,
  changed_by VARCHAR(255) NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_config_history_config ON config_history(config_id, changed_at DESC);

-- User sessions with device tracking
CREATE TABLE IF NOT EXISTS user_sessions (
  id VARCHAR(255) PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL,
  token_hash VARCHAR(64) NOT NULL, -- SHA-256 hashed token
  device VARCHAR(255),
  ip_hash VARCHAR(64), -- SHA-256 hashed IP for GDPR
  last_active TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sessions_user ON user_sessions(user_id, last_active DESC);
CREATE INDEX idx_sessions_token ON user_sessions(token_hash);

-- User profiles
CREATE TABLE IF NOT EXISTS user_profiles (
  user_id VARCHAR(255) PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  name VARCHAR(255),
  bio TEXT,
  avatar_url TEXT,
  email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ -- Soft delete for GDPR (30-day retention)
);

CREATE INDEX idx_profiles_email ON user_profiles(email) WHERE deleted_at IS NULL;
CREATE INDEX idx_profiles_deleted ON user_profiles(deleted_at) WHERE deleted_at IS NOT NULL;

-- Email verification tokens
CREATE TABLE IF NOT EXISTS email_verification_tokens (
  token VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL REFERENCES user_profiles(user_id),
  new_email VARCHAR(255) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_email_tokens_user ON email_verification_tokens(user_id);
CREATE INDEX idx_email_tokens_expires ON email_verification_tokens(expires_at);

-- Password change audit (separate for security)
CREATE TABLE IF NOT EXISTS password_changes (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL,
  ip_hash VARCHAR(64),
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_password_changes_user ON password_changes(user_id, changed_at DESC);

-- Rate limiting tracking
CREATE TABLE IF NOT EXISTS rate_limits (
  key VARCHAR(255) PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 1,
  window_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_rate_limits_expires ON rate_limits(expires_at);
