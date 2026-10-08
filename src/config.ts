import 'dotenv/config'
import { loadSessionSecret } from './secret.js'

const value = (name: string, fallback?: string) => {
  const result = process.env[name] ?? fallback
  if (!result) throw new Error(`Missing environment variable: ${name}`)
  return result
}

export const config = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: value('DATABASE_URL', 'postgres://pm:pm@localhost:5432/gitea_pm'),
  giteaBaseUrl: (process.env.GITEA_BASE_URL ?? '').replace(/\/+$/, ''),
  giteaClientId: process.env.GITEA_CLIENT_ID ?? '',
  giteaClientSecret: process.env.GITEA_CLIENT_SECRET ?? '',
  giteaRedirectUri: process.env.GITEA_REDIRECT_URI ?? 'http://localhost:3000/auth/gitea/callback',
  giteaWebhookSecret: process.env.GITEA_WEBHOOK_SECRET ?? '',
  sessionSecret: loadSessionSecret(process.env.SESSION_SECRET, process.env.SESSION_SECRET_FILE ?? '.data/session-secret'),
  sessionCookieSecure: process.env.SESSION_COOKIE_SECURE === undefined ? process.env.NODE_ENV === 'production' : process.env.SESSION_COOKIE_SECURE === 'true',
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
}
