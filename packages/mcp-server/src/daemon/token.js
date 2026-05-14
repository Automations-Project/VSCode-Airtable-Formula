import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { getHomeDir } from '../paths.js';

/**
 * @typedef {Object} DaemonTokenRecord
 * @property {string} bearerToken
 * @property {number} version
 * @property {string} createdAt
 * @property {string} rotatedAt
 */

export function getTokenPath(configDir = getHomeDir()) {
  return join(configDir, 'daemon.token');
}

export function generateBearerToken() {
  return randomBytes(32).toString('base64url');
}

export function readToken(options = {}) {
  const tokenPath = options.tokenPath ?? getTokenPath();
  if (!existsSync(tokenPath)) {
    return null;
  }

  const parsed = JSON.parse(readFileSync(tokenPath, 'utf8'));
  return normalizeRecord(parsed);
}

export function ensureToken(options = {}) {
  const existing = readToken(options);
  if (existing) {
    return existing;
  }

  const now = (options.now ?? defaultNow)();
  const record = {
    bearerToken: generateBearerToken(),
    version: 1,
    createdAt: now,
    rotatedAt: now,
  };
  writeToken(record, options);
  return record;
}

export function rotateToken(options = {}) {
  const previous = readToken(options);
  const now = (options.now ?? defaultNow)();
  const record = {
    bearerToken: generateBearerToken(),
    version: (previous?.version ?? 0) + 1,
    createdAt: previous?.createdAt ?? now,
    rotatedAt: now,
  };
  writeToken(record, options);
  return record;
}

function writeToken(record, options = {}) {
  const tokenPath = options.tokenPath ?? getTokenPath();
  const normalized = normalizeRecord(record);
  mkdirSync(dirname(tokenPath), { recursive: true });
  const tmp = tokenPath + '.tmp';
  writeFileSync(tmp, JSON.stringify(normalized, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
  renameSync(tmp, tokenPath);
  try {
    applyPrivatePermissions(tokenPath);
  } catch (err) {
    console.warn('[airtable-mcp] token file permission restriction failed (non-fatal):', err.message);
  }
}

function normalizeRecord(value) {
  if (!value || typeof value !== 'object') {
    throw new Error('Daemon token file must contain a JSON object.');
  }

  const record = value;
  if (typeof record.bearerToken !== 'string' || record.bearerToken.length === 0) {
    throw new Error("Daemon token file field 'bearerToken' must be a non-empty string.");
  }
  if (!Number.isInteger(record.version) || Number(record.version) <= 0) {
    throw new Error("Daemon token file field 'version' must be a positive integer.");
  }
  if (typeof record.createdAt !== 'string' || record.createdAt.length === 0) {
    throw new Error("Daemon token file field 'createdAt' must be a non-empty string.");
  }
  if (typeof record.rotatedAt !== 'string' || record.rotatedAt.length === 0) {
    throw new Error("Daemon token file field 'rotatedAt' must be a non-empty string.");
  }

  return {
    bearerToken: record.bearerToken,
    version: Number(record.version),
    createdAt: record.createdAt,
    rotatedAt: record.rotatedAt,
  };
}

function applyPrivatePermissions(tokenPath) {
  if (process.platform === 'win32') {
    restrictWindowsAcl(tokenPath);
  } else {
    try { chmodSync(tokenPath, 0o600); } catch { /* non-fatal */ }
  }
}

function restrictWindowsAcl(tokenPath) {
  try {
    const username = process.env.USERNAME;
    const domain = process.env.USERDOMAIN;
    const target = domain && username ? `${domain}\\${username}` : username;
    if (!target) throw new Error('Cannot resolve Windows username');
    const result = spawnSync('icacls', [tokenPath, '/inheritance:r', '/grant:r', `${target}:(R,W)`], {
      encoding: 'utf8',
      windowsHide: true,
    });
    if (result.status !== 0) {
      const detail = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
      throw new Error(`icacls failed: ${detail}`);
    }
  } catch (err) {
    console.warn('[airtable-mcp] Windows token ACL restriction failed (non-fatal):', err.message);
  }
}

function defaultNow() {
  return new Date().toISOString();
}
