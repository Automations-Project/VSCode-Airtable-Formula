import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { getHomeDir } from '../paths.js';
import { safeAtomicWriteFileSync } from '../safe-write.js';
import { applyPrivatePermissions } from './token.js';

/**
 * @typedef {Object} DaemonLockRecord
 * @property {number} pid
 * @property {string} uuid
 * @property {number} port
 * @property {number|null} port_lsp
 * @property {string} bearerToken
 * @property {string} version
 * @property {string} startedAt
 * @property {string|null} tunnelUrl
 */

export function getLockfilePath(configDir = getHomeDir()) {
  return join(configDir, 'daemon.lock');
}

export function acquire(record, options = {}) {
  const lockPath = options.lockPath ?? getLockfilePath();
  const normalized = normalizeRecord(record);

  mkdirSync(dirname(lockPath), { recursive: true });

  for (let attempt = 0; attempt < 2; attempt++) {
    let fd;
    try {
      // 0o600 — the lockfile carries the plaintext bearerToken; without an
      // explicit mode it would be created world-readable (default 0o644).
      fd = openSync(lockPath, 'wx', 0o600);
    } catch (error) {
      if (isExistsError(error)) {
        if (attempt === 0 && tryReclaimStale(lockPath)) {
          continue;
        }
        return false;
      }
      throw error;
    }

    let wrote = false;
    try {
      writeFileSync(fd, serialize(normalized), 'utf8');
      wrote = true;
    } finally {
      closeSync(fd);
      if (!wrote) {
        rmSync(lockPath, { force: true });
      }
    }

    applyPrivatePermissions(lockPath);
    return true;
  }

  return false;
}

function tryReclaimStale(lockPath) {
  let existing = null;
  try {
    existing = read({ lockPath });
  } catch {
    try {
      rmSync(lockPath, { force: true });
      return true;
    } catch {
      return false;
    }
  }
  if (!isStale(existing)) {
    return false;
  }
  try {
    rmSync(lockPath, { force: true });
    return true;
  } catch {
    return false;
  }
}

export function read(options = {}) {
  const lockPath = options.lockPath ?? getLockfilePath();
  if (!existsSync(lockPath)) {
    return null;
  }

  const parsed = JSON.parse(readFileSync(lockPath, 'utf8'));
  return normalizeRecord(parsed);
}

export function release(options = {}) {
  const lockPath = options.lockPath ?? getLockfilePath();
  if (!existsSync(lockPath)) {
    return false;
  }

  if (options.expectedUuid) {
    const current = read({ lockPath });
    if (!current || current.uuid !== options.expectedUuid) {
      return false;
    }
  }

  rmSync(lockPath, { force: true });
  return true;
}

export function replace(record, options = {}) {
  const lockPath = options.lockPath ?? getLockfilePath();
  const normalized = normalizeRecord(record);

  if (options.expectedUuid) {
    const current = read({ lockPath });
    if (!current || current.uuid !== options.expectedUuid) {
      return false;
    }
  }

  mkdirSync(dirname(lockPath), { recursive: true });
  safeAtomicWriteFileSync(lockPath, serialize(normalized), { encoding: 'utf8', mode: 0o600 });
  applyPrivatePermissions(lockPath);
  return true;
}

export function isStale(record, options = {}) {
  if (!record) {
    return true;
  }

  if (!Number.isInteger(record.pid) || record.pid <= 0) {
    return true;
  }

  if (!record.uuid || typeof record.uuid !== 'string') {
    return true;
  }

  if (options.echoedUuid && options.echoedUuid !== record.uuid) {
    return true;
  }

  return !isProcessAlive(record.pid);
}

function normalizeRecord(value) {
  if (!value || typeof value !== 'object') {
    throw new Error('Daemon lockfile must contain a JSON object.');
  }

  const record = value;
  const pid = asPositiveInteger(record.pid, 'pid');
  const port = asPort(record.port);
  const uuid = asRequiredString(record.uuid, 'uuid');
  const bearerToken = asRequiredString(record.bearerToken, 'bearerToken');
  const version = asRequiredString(record.version, 'version');
  const startedAt = asRequiredString(record.startedAt, 'startedAt');

  return {
    pid,
    port,
    port_lsp: asOptionalInteger(record.port_lsp, 'port_lsp'),
    uuid,
    bearerToken,
    version,
    startedAt,
    tunnelUrl: asOptionalString(record.tunnelUrl, 'tunnelUrl'),
  };
}

function asPositiveInteger(value, name) {
  if (!Number.isInteger(value) || Number(value) <= 0) {
    throw new Error(`Daemon lockfile field '${name}' must be a positive integer.`);
  }
  return Number(value);
}

function asPort(value) {
  if (!Number.isInteger(value) || Number(value) < 0 || Number(value) > 65535) {
    throw new Error("Daemon lockfile field 'port' must be an integer between 0 and 65535.");
  }
  return Number(value);
}

function asRequiredString(value, name) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Daemon lockfile field '${name}' must be a non-empty string.`);
  }
  return value;
}

function asOptionalInteger(value, name) {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (!Number.isInteger(value) || Number(value) <= 0) {
    throw new Error(`Daemon lockfile field '${name}' must be a positive integer when present.`);
  }
  return Number(value);
}

function asOptionalString(value, name) {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    throw new Error(`Daemon lockfile field '${name}' must be a string when present.`);
  }
  return value;
}

function serialize(record) {
  return JSON.stringify(record, null, 2) + '\n';
}

function isExistsError(error) {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === 'EEXIST';
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'EPERM') {
      return true;
    }
    return false;
  }
}
