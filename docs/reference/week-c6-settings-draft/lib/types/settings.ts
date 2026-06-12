export interface UserSettings {
  userId: string;
  data: Record<string, unknown>;
  version: number;
  updatedAt: Date;
}

export interface UserPreferences {
  userId: string;
  appearance: {
    theme: 'light' | 'dark' | 'system';
    density: 'comfortable' | 'compact';
  };
  localization: {
    locale: string;
    timezone: string;
  };
  notifications: {
    email: boolean;
    push: boolean;
  };
  version: number;
  updatedAt: Date;
}

export interface Configuration {
  id: number;
  key: string;
  value: unknown;
  environment: string;
  version: number;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuditLog {
  id: number;
  userId: string;
  action: string;
  tableName: string;
  oldValue?: Record<string, unknown>;
  newValue?: Record<string, unknown>;
  ipHash?: string;
  createdAt: Date;
}

export interface UserProfile {
  userId: string;
  email: string;
  name?: string;
  bio?: string;
  avatarUrl?: string;
  emailVerified: boolean;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;
}

export interface UserSession {
  id: string;
  userId: string;
  tokenHash: string;
  device?: string;
  ipHash?: string;
  lastActive: Date;
  createdAt: Date;
}

export interface VersionConflictError {
  code: 'VERSION_CONFLICT';
  message: string;
  currentVersion: number;
  attemptedVersion: number;
}
