import type {
  ExtensionMessage,
  WebviewMessage,
  WebviewSettingChange,
} from './messages.js';
import type {
  AuthState,
  BrowserChoiceSummary,
  BrowserInfo,
  DashboardState,
  DaemonStatusInfo,
  DebugState,
  IdeStatus,
  OfficialAirtableMcpState,
  PromptDef,
  SettingsSnapshot,
  StorageInfo,
  ToolCategories,
  TunnelState,
  VersionInfo,
} from './types.js';

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: string; type?: string };

export const PROMPT_NAME_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;
export const PROMPT_ARG_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
export const MAX_PROMPT_ARGUMENTS = 16;
export const MAX_PROMPT_TEMPLATE_LENGTH = 16_384;

const IDE_IDS = [
  'cursor',
  'windsurf',
  'windsurf-next',
  'claude-code',
  'claude-desktop',
  'cline',
  'amp',
  'opencode',
  'codex-cli',
  'zed',
  'helix',
  'neovim',
] as const;

const AI_FILE_STATUSES = ['ok', 'missing', 'partial'] as const;
const AUTH_STATUSES = [
  'unknown',
  'checking',
  'valid',
  'expired',
  'error',
  'logging-in',
  'chrome-missing',
] as const;
const BROWSER_CHANNELS = ['chrome', 'msedge', 'chromium'] as const;
const BROWSER_IDS = [
  'chrome',
  'edge',
  'chromium',
  'brave',
  'bundled-chromium',
  'custom-browser',
] as const;
const DETECTED_BROWSER_IDS = [
  'chrome',
  'edge',
  'chromium',
  'brave',
  'bundled-chromium',
] as const;
const BROWSER_DOWNLOAD_STATUSES = [
  'idle',
  'downloading',
  'done',
  'error',
] as const;
const STORAGE_ENTRY_IDS = [
  'browser-profile',
  'tool-config',
  'bundled-chromium',
] as const;
const WEBVIEW_LINK_IDS = ['docs', 'changelog', 'github', 'chrome'] as const;
const TOOL_PROFILE_NAMES = [
  'read-only',
  'safe-write',
  'full',
  'custom',
] as const;
const TOOL_CATEGORY_KEYS = [
  'read',
  'recordRead',
  'tableWrite',
  'tableDestructive',
  'fieldWrite',
  'fieldDestructive',
  'recordDestructive',
  'viewWrite',
  'viewDestructive',
  'viewSection',
  'viewSectionDestructive',
  'formWrite',
  'extension',
  'recordWrite',
  'sync',
] as const;
const TUNNEL_PROVIDER_IDS = ['cf-quick', 'ngrok', 'cf-named'] as const;
const TUNNEL_STATUSES = [
  'disabled',
  'starting',
  'active',
  'auto-disabled',
  'error',
] as const;
const BEAUTIFY_STYLES = [
  'default',
  'compact',
  'singleQuote',
  'tabIndent',
  'semicolonFree',
] as const;
const MINIFY_LEVELS = [
  'safe',
  'standard',
  'aggressive',
  'extreme',
] as const;

function isPlainRecord(input: unknown): input is Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(input);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(
  input: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const allowed = new Set([...required, ...optional]);
  return required.every(key => Object.hasOwn(input, key))
    && Object.keys(input).every(key => allowed.has(key));
}

function hasOptional(
  input: Record<string, unknown>,
  key: string,
  predicate: (value: unknown) => boolean,
): boolean {
  return !Object.hasOwn(input, key) || predicate(input[key]);
}

function isOneOf(input: unknown, values: readonly string[]): boolean {
  return typeof input === 'string' && values.includes(input);
}

function isStringInRange(input: unknown, minimum: number, maximum: number): boolean {
  return typeof input === 'string'
    && input.length >= minimum
    && input.length <= maximum;
}

function isIntegerInRange(input: unknown, minimum: number, maximum: number): boolean {
  return typeof input === 'number'
    && Number.isInteger(input)
    && input >= minimum
    && input <= maximum;
}

function isNonNegativeNumber(input: unknown): boolean {
  return typeof input === 'number' && Number.isFinite(input) && input >= 0;
}

function isNullableString(input: unknown): boolean {
  return input === null || typeof input === 'string';
}

function isNullablePort(input: unknown): boolean {
  return input === null || isIntegerInRange(input, 0, 65_535);
}

function success<T>(value: unknown): ParseResult<T> {
  return { ok: true, value: value as T };
}

function failure(reason: string, type?: string): ParseResult<never> {
  return type === undefined
    ? { ok: false, reason }
    : { ok: false, reason, type };
}

export function isActionId(input: unknown): input is string {
  return typeof input === 'string' && /^[a-z0-9]{6,32}$/.test(input);
}

export function isPromptDef(input: unknown): input is PromptDef {
  if (
    !isPlainRecord(input)
    || !hasExactKeys(
      input,
      ['name', 'description', 'arguments', 'template', 'isBuiltin', 'isModified'],
    )
    || typeof input.name !== 'string'
    || !PROMPT_NAME_PATTERN.test(input.name)
    || !isStringInRange(input.description, 0, 2_048)
    || !Array.isArray(input.arguments)
    || input.arguments.length > MAX_PROMPT_ARGUMENTS
    || !isStringInRange(input.template, 0, MAX_PROMPT_TEMPLATE_LENGTH)
    || typeof input.isBuiltin !== 'boolean'
    || typeof input.isModified !== 'boolean'
  ) {
    return false;
  }

  const names = new Set<string>();
  for (const argument of input.arguments) {
    if (
      !isPlainRecord(argument)
      || !hasExactKeys(argument, ['name', 'description', 'required'])
      || typeof argument.name !== 'string'
      || !PROMPT_ARG_NAME_PATTERN.test(argument.name)
      || !isStringInRange(argument.description, 0, 2_048)
      || typeof argument.required !== 'boolean'
      || names.has(argument.name)
    ) {
      return false;
    }
    names.add(argument.name);
  }

  return true;
}

function isBrowserInfo(input: unknown): input is BrowserInfo {
  if (!isPlainRecord(input) || typeof input.found !== 'boolean') {
    return false;
  }
  if (!input.found) {
    return hasExactKeys(input, ['found']);
  }
  return hasExactKeys(input, ['found', 'id', 'channel', 'label'], ['downloaded'])
    && isOneOf(input.id, BROWSER_IDS)
    && isOneOf(input.channel, BROWSER_CHANNELS)
    && typeof input.label === 'string'
    && hasOptional(input, 'downloaded', value => typeof value === 'boolean');
}

function isBrowserChoiceSummary(input: unknown): input is BrowserChoiceSummary {
  if (!isPlainRecord(input) || typeof input.mode !== 'string') {
    return false;
  }
  switch (input.mode) {
    case 'auto':
      return hasExactKeys(input, ['mode']);
    case 'detected':
      return hasExactKeys(input, ['mode', 'browserId', 'label'])
        && isOneOf(input.browserId, DETECTED_BROWSER_IDS)
        && typeof input.label === 'string';
    case 'custom':
      return hasExactKeys(input, ['mode', 'label'])
        && typeof input.label === 'string';
    default:
      return false;
  }
}

function isBrowserDownloadState(input: unknown): boolean {
  return isPlainRecord(input)
    && hasExactKeys(input, ['status'], ['progress', 'error'])
    && isOneOf(input.status, BROWSER_DOWNLOAD_STATUSES)
    && hasOptional(
      input,
      'progress',
      value => typeof value === 'number'
        && Number.isFinite(value)
        && value >= 0
        && value <= 100,
    )
    && hasOptional(input, 'error', value => typeof value === 'string');
}

function isAiFiles(input: unknown): boolean {
  return isPlainRecord(input)
    && hasExactKeys(input, ['skills', 'rules', 'workflows', 'agents'])
    && isOneOf(input.skills, AI_FILE_STATUSES)
    && isOneOf(input.rules, AI_FILE_STATUSES)
    && isOneOf(input.workflows, AI_FILE_STATUSES)
    && isOneOf(input.agents, AI_FILE_STATUSES);
}

function isIdeStatus(input: unknown): input is IdeStatus {
  return isPlainRecord(input)
    && hasExactKeys(
      input,
      ['ideId', 'label', 'detected', 'mcpConfigured', 'aiFiles'],
      [
        'version',
        'mcpServerHealthy',
        'lspConfigured',
        'lspManualStep',
      ],
    )
    && isOneOf(input.ideId, IDE_IDS)
    && typeof input.label === 'string'
    && typeof input.detected === 'boolean'
    && typeof input.mcpConfigured === 'boolean'
    && isAiFiles(input.aiFiles)
    && hasOptional(input, 'version', value => typeof value === 'string')
    && hasOptional(input, 'mcpServerHealthy', value => typeof value === 'boolean')
    && hasOptional(input, 'lspConfigured', value => typeof value === 'boolean')
    && hasOptional(input, 'lspManualStep', value => typeof value === 'string');
}

function isToolCategories(input: unknown): input is ToolCategories {
  return isPlainRecord(input)
    && hasExactKeys(input, TOOL_CATEGORY_KEYS)
    && TOOL_CATEGORY_KEYS.every(key => typeof input[key] === 'boolean');
}

function isToolProfileSnapshot(input: unknown): boolean {
  return isPlainRecord(input)
    && hasExactKeys(input, ['profile', 'enabledCount', 'totalCount', 'categories'])
    && isOneOf(input.profile, TOOL_PROFILE_NAMES)
    && isIntegerInRange(input.enabledCount, 0, Number.MAX_SAFE_INTEGER)
    && isIntegerInRange(input.totalCount, 0, Number.MAX_SAFE_INTEGER)
    && isToolCategories(input.categories);
}

function isSettingsSnapshot(input: unknown): input is SettingsSnapshot {
  if (
    !isPlainRecord(input)
    || !hasExactKeys(input, ['mcp', 'ai', 'formula', 'script', 'auth', 'debug'])
    || !isPlainRecord(input.mcp)
    || !hasExactKeys(
      input.mcp,
      [
        'autoConfigureOnInstall',
        'notifyOnUpdates',
        'toolProfile',
        'serverSource',
        'daemonPort',
        'authMode',
        'httpClient',
        'useDaemon',
        'browserIdleParkMinutes',
      ],
    )
    || typeof input.mcp.autoConfigureOnInstall !== 'boolean'
    || typeof input.mcp.notifyOnUpdates !== 'boolean'
    || !isToolProfileSnapshot(input.mcp.toolProfile)
    || !isOneOf(input.mcp.serverSource, ['bundled', 'npx'])
    || !isIntegerInRange(input.mcp.daemonPort, 0, 65_535)
    || !isOneOf(input.mcp.authMode, ['browser', 'byo', 'direct-login'])
    || !isOneOf(input.mcp.httpClient, ['fetch', 'impit'])
    || typeof input.mcp.useDaemon !== 'boolean'
    || !isIntegerInRange(input.mcp.browserIdleParkMinutes, 0, 525_600)
  ) {
    return false;
  }

  if (
    !isPlainRecord(input.ai)
    || !hasExactKeys(input.ai, ['autoInstallFiles', 'includeAgents'])
    || typeof input.ai.autoInstallFiles !== 'boolean'
    || typeof input.ai.includeAgents !== 'boolean'
    || !isPlainRecord(input.formula)
    || !hasExactKeys(input.formula, ['formatterVersion'])
    || !isOneOf(input.formula.formatterVersion, ['v1', 'v2'])
    || !isPlainRecord(input.script)
    || !hasExactKeys(input.script, ['beautifyStyle', 'minifyLevel'])
    || !isOneOf(input.script.beautifyStyle, BEAUTIFY_STYLES)
    || !isOneOf(input.script.minifyLevel, MINIFY_LEVELS)
  ) {
    return false;
  }

  if (
    !isPlainRecord(input.auth)
    || !hasExactKeys(
      input.auth,
      ['autoRefresh', 'refreshIntervalHours', 'loginMode'],
      ['browserChoice'],
    )
    || typeof input.auth.autoRefresh !== 'boolean'
    || !isIntegerInRange(input.auth.refreshIntervalHours, 1, 168)
    || !isOneOf(input.auth.loginMode, ['manual', 'auto'])
    || !hasOptional(input.auth, 'browserChoice', isBrowserChoiceSummary)
    || !isPlainRecord(input.debug)
    || !hasExactKeys(input.debug, ['enabled', 'verboseHttp', 'bufferSize'])
    || typeof input.debug.enabled !== 'boolean'
    || typeof input.debug.verboseHttp !== 'boolean'
    || !isIntegerInRange(input.debug.bufferSize, 100, 10_000)
  ) {
    return false;
  }

  return true;
}

function isVersionInfo(input: unknown): input is VersionInfo {
  return isPlainRecord(input)
    && hasExactKeys(
      input,
      ['extension', 'mcpServerBundled'],
      ['mcpServerPublished', 'bundledFromGitSha'],
    )
    && typeof input.extension === 'string'
    && typeof input.mcpServerBundled === 'string'
    && hasOptional(input, 'mcpServerPublished', value => typeof value === 'string')
    && hasOptional(input, 'bundledFromGitSha', value => typeof value === 'string');
}

function isAuthState(input: unknown): input is AuthState {
  return isPlainRecord(input)
    && hasExactKeys(
      input,
      ['status', 'hasCredentials'],
      [
        'userId',
        'lastChecked',
        'lastLogin',
        'error',
        'hasCookie',
        'browser',
        'browserDownload',
        'availableBrowsers',
        'browserChoice',
      ],
    )
    && isOneOf(input.status, AUTH_STATUSES)
    && typeof input.hasCredentials === 'boolean'
    && hasOptional(input, 'userId', value => typeof value === 'string')
    && hasOptional(input, 'lastChecked', value => typeof value === 'string')
    && hasOptional(input, 'lastLogin', value => typeof value === 'string')
    && hasOptional(input, 'error', value => typeof value === 'string')
    && hasOptional(input, 'hasCookie', value => typeof value === 'boolean')
    && hasOptional(input, 'browser', isBrowserInfo)
    && hasOptional(input, 'browserDownload', isBrowserDownloadState)
    && hasOptional(
      input,
      'availableBrowsers',
      value => Array.isArray(value) && value.every(isBrowserInfo),
    )
    && hasOptional(input, 'browserChoice', isBrowserChoiceSummary);
}

function isDebugState(input: unknown): input is DebugState {
  return isPlainRecord(input)
    && hasExactKeys(
      input,
      ['enabled', 'sessionActive', 'eventCount', 'bufferCapacity', 'verboseHttp'],
    )
    && typeof input.enabled === 'boolean'
    && typeof input.sessionActive === 'boolean'
    && isIntegerInRange(input.eventCount, 0, Number.MAX_SAFE_INTEGER)
    && isIntegerInRange(input.bufferCapacity, 0, Number.MAX_SAFE_INTEGER)
    && typeof input.verboseHttp === 'boolean';
}

function isStorageInfo(input: unknown): input is StorageInfo {
  return isPlainRecord(input)
    && hasExactKeys(input, ['entries'])
    && Array.isArray(input.entries)
    && input.entries.every(entry =>
      isPlainRecord(entry)
      && hasExactKeys(entry, ['id', 'label', 'exists'], ['sizeBytes'])
      && isOneOf(entry.id, STORAGE_ENTRY_IDS)
      && typeof entry.label === 'string'
      && typeof entry.exists === 'boolean'
      && hasOptional(
        entry,
        'sizeBytes',
        value => isIntegerInRange(value, 0, Number.MAX_SAFE_INTEGER),
      ));
}

function isTunnelAutoDisabledReason(input: unknown): boolean {
  return isPlainRecord(input)
    && hasExactKeys(input, ['failures', 'windowMs', 'ip'])
    && isIntegerInRange(input.failures, 0, Number.MAX_SAFE_INTEGER)
    && isIntegerInRange(input.windowMs, 0, Number.MAX_SAFE_INTEGER)
    && isNullableString(input.ip);
}

function isTunnelState(input: unknown): input is TunnelState {
  return isPlainRecord(input)
    && hasExactKeys(
      input,
      ['status', 'url', 'provider', 'ngrokAuthtokenSet', 'autoDisabledReason'],
      ['namedTunnelHostname'],
    )
    && isOneOf(input.status, TUNNEL_STATUSES)
    && isNullableString(input.url)
    && isOneOf(input.provider, TUNNEL_PROVIDER_IDS)
    && typeof input.ngrokAuthtokenSet === 'boolean'
    && (
      input.autoDisabledReason === null
      || isTunnelAutoDisabledReason(input.autoDisabledReason)
    )
    && hasOptional(input, 'namedTunnelHostname', isNullableString);
}

function isDaemonStatusInfo(input: unknown): input is DaemonStatusInfo {
  return isPlainRecord(input)
    && hasExactKeys(
      input,
      ['running', 'healthy', 'port', 'port_lsp', 'tunnelUrl', 'uptime'],
      ['starting'],
    )
    && typeof input.running === 'boolean'
    && typeof input.healthy === 'boolean'
    && isNullablePort(input.port)
    && isNullablePort(input.port_lsp)
    && isNullableString(input.tunnelUrl)
    && (input.uptime === null || isNonNegativeNumber(input.uptime))
    && hasOptional(input, 'starting', value => typeof value === 'boolean');
}

function isOfficialAirtableMcpState(
  input: unknown,
): input is OfficialAirtableMcpState {
  return isPlainRecord(input)
    && hasExactKeys(input, ['patSet', 'ideConfigured'])
    && typeof input.patSet === 'boolean'
    && isPlainRecord(input.ideConfigured)
    && hasExactKeys(input.ideConfigured, [], IDE_IDS)
    && Object.values(input.ideConfigured).every(value => typeof value === 'boolean');
}

function isPromptsState(input: unknown): boolean {
  return isPlainRecord(input)
    && hasExactKeys(input, ['prompts'])
    && Array.isArray(input.prompts)
    && input.prompts.every(isPromptDef);
}

function isDashboardState(input: unknown): input is DashboardState {
  return isPlainRecord(input)
    && hasExactKeys(
      input,
      ['ideStatuses', 'versions', 'aiFilesCount', 'loading', 'settings', 'auth'],
      ['debug', 'storage', 'tunnel', 'daemon', 'officialAirtable', 'prompts'],
    )
    && Array.isArray(input.ideStatuses)
    && input.ideStatuses.every(isIdeStatus)
    && isVersionInfo(input.versions)
    && isIntegerInRange(input.aiFilesCount, 0, Number.MAX_SAFE_INTEGER)
    && typeof input.loading === 'boolean'
    && isSettingsSnapshot(input.settings)
    && isAuthState(input.auth)
    && hasOptional(input, 'debug', isDebugState)
    && hasOptional(input, 'storage', isStorageInfo)
    && hasOptional(input, 'tunnel', isTunnelState)
    && hasOptional(input, 'daemon', isDaemonStatusInfo)
    && hasOptional(input, 'officialAirtable', isOfficialAirtableMcpState)
    && hasOptional(input, 'prompts', isPromptsState);
}

function isWebviewBrowserChoice(input: unknown): boolean {
  if (!isPlainRecord(input) || typeof input.mode !== 'string') {
    return false;
  }
  switch (input.mode) {
    case 'auto':
      return hasExactKeys(input, ['mode']);
    case 'detected':
      return hasExactKeys(input, ['mode', 'browserId'])
        && isOneOf(input.browserId, DETECTED_BROWSER_IDS);
    default:
      return false;
  }
}

function isWebviewSettingChange(input: unknown): input is WebviewSettingChange {
  if (
    !isPlainRecord(input)
    || typeof input.key !== 'string'
    || !Object.hasOwn(input, 'key')
  ) {
    return false;
  }

  switch (input.key) {
    case 'auth.autoRefresh':
    case 'mcp.autoConfigureOnInstall':
    case 'mcp.notifyOnUpdates':
    case 'ai.autoInstallFiles':
    case 'ai.includeAgents':
    case 'debug.enabled':
    case 'debug.verboseHttp':
      return hasExactKeys(input, ['key', 'value'])
        && typeof input.value === 'boolean';
    case 'auth.refreshIntervalHours':
      return hasExactKeys(input, ['key', 'value'])
        && isIntegerInRange(input.value, 1, 168);
    case 'auth.loginMode':
      return hasExactKeys(input, ['key', 'value'])
        && isOneOf(input.value, ['manual', 'auto']);
    case 'mcp.authMode':
      return hasExactKeys(input, ['key', 'value'])
        && isOneOf(input.value, ['browser', 'byo', 'direct-login']);
    case 'mcp.httpClient':
      return hasExactKeys(input, ['key', 'value'])
        && isOneOf(input.value, ['fetch', 'impit']);
    case 'mcp.serverSource':
      return hasExactKeys(input, ['key', 'value'])
        && isOneOf(input.value, ['bundled', 'npx']);
    case 'mcp.daemonPort':
      return hasExactKeys(input, ['key', 'value'])
        && isIntegerInRange(input.value, 0, 65_535);
    case 'mcp.browserIdleParkMinutes':
      return hasExactKeys(input, ['key', 'value'])
        && isIntegerInRange(input.value, 0, 525_600);
    case 'mcp.toolProfile':
      return hasExactKeys(input, ['key', 'value'])
        && isOneOf(input.value, TOOL_PROFILE_NAMES);
    case 'mcp.category':
      return hasExactKeys(input, ['key', 'category', 'value'])
        && isOneOf(input.category, TOOL_CATEGORY_KEYS)
        && typeof input.value === 'boolean';
    case 'formula.formatterVersion':
      return hasExactKeys(input, ['key', 'value'])
        && isOneOf(input.value, ['v1', 'v2']);
    case 'script.beautifyStyle':
      return hasExactKeys(input, ['key', 'value'])
        && isOneOf(input.value, BEAUTIFY_STYLES);
    case 'script.minifyLevel':
      return hasExactKeys(input, ['key', 'value'])
        && isOneOf(input.value, MINIFY_LEVELS);
    case 'debug.bufferSize':
      return hasExactKeys(input, ['key', 'value'])
        && isIntegerInRange(input.value, 100, 10_000);
    default:
      return false;
  }
}

function isTunnelDomain(input: unknown): boolean {
  if (typeof input !== 'string' || input.length < 1 || input.length > 255) {
    return false;
  }
  return /^(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)(?:\.(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?))*$/.test(input);
}

function parseWebviewMessageByType(
  type: string,
  input: Record<string, unknown>,
): ParseResult<WebviewMessage> {
  const invalid = (reason: string) => failure(reason, type);
  const hasId = () => isActionId(input.id);

  switch (type) {
    case 'ready':
      return hasExactKeys(input, ['type'])
        ? success<WebviewMessage>(input)
        : invalid('ready has invalid fields');
    case 'action:setupAll':
    case 'action:refresh':
    case 'action:login':
    case 'action:logout':
    case 'action:status':
    case 'auth:clearCookie':
    case 'action:install-browser':
    case 'action:removeBrowser':
    case 'action:openToolConfig':
    case 'action:debug.startSession':
    case 'action:debug.stopAndExport':
    case 'action:debug.export':
    case 'action:manualLogin':
    case 'action:backupSession':
    case 'action:restoreSession':
    case 'action:selectCustomBrowser':
    case 'tunnel:disable':
    case 'daemon:start':
    case 'daemon:stop':
    case 'daemon:restart':
    case 'daemon:copy-bearer-token':
    case 'daemon:rotate-token':
    case 'action:copy-airtable-pat':
      return hasExactKeys(input, ['type', 'id']) && hasId()
        ? success<WebviewMessage>(input)
        : invalid('message has invalid fields or action id');
    case 'action:setupIde':
    case 'action:unconfigureIde':
    case 'action:openIdeDocs':
    case 'action:configure-official-airtable':
    case 'action:unconfigure-official-airtable':
      return hasExactKeys(input, ['type', 'id', 'ideId'])
        && hasId()
        && isOneOf(input.ideId, IDE_IDS)
        ? success<WebviewMessage>(input)
        : invalid('message has invalid fields, action id, or IDE id');
    case 'action:saveCredentials':
      return hasExactKeys(
        input,
        ['type', 'id', 'email', 'password', 'otpSecret'],
      )
        && hasId()
        && isStringInRange(input.email, 1, 320)
        && isStringInRange(input.password, 1, 1_024)
        && isStringInRange(input.otpSecret, 0, 128)
        ? success<WebviewMessage>(input)
        : invalid('credentials payload is invalid');
    case 'auth:saveCookie':
      return hasExactKeys(input, ['type', 'id', 'cookie'])
        && hasId()
        && isStringInRange(input.cookie, 1, 8_192)
        ? success<WebviewMessage>(input)
        : invalid('cookie payload is invalid');
    case 'setting:change':
      return hasExactKeys(input, ['type', 'id', 'change'])
        && hasId()
        && isWebviewSettingChange(input.change)
        ? success<WebviewMessage>(input)
        : invalid('setting change is invalid');
    case 'action:openLink':
      return hasExactKeys(input, ['type', 'id', 'link'])
        && hasId()
        && isOneOf(input.link, WEBVIEW_LINK_IDS)
        ? success<WebviewMessage>(input)
        : invalid('external link payload is invalid');
    case 'action:openStoragePath':
      return hasExactKeys(input, ['type', 'id', 'entryId'])
        && hasId()
        && isOneOf(input.entryId, STORAGE_ENTRY_IDS)
        ? success<WebviewMessage>(input)
        : invalid('storage entry payload is invalid');
    case 'action:setBrowserChoice':
      return hasExactKeys(input, ['type', 'id', 'choice'])
        && hasId()
        && isWebviewBrowserChoice(input.choice)
        ? success<WebviewMessage>(input)
        : invalid('browser choice payload is invalid');
    case 'tunnel:enable':
      return hasExactKeys(
        input,
        ['type', 'id', 'provider'],
        ['authtoken', 'domain'],
      )
        && hasId()
        && isOneOf(input.provider, TUNNEL_PROVIDER_IDS)
        && hasOptional(
          input,
          'authtoken',
          value => isStringInRange(value, 1, 512),
        )
        && hasOptional(input, 'domain', isTunnelDomain)
        ? success<WebviewMessage>(input)
        : invalid('tunnel payload is invalid');
    case 'tunnel:set-ngrok-authtoken':
      return hasExactKeys(input, ['type', 'id', 'authtoken'])
        && hasId()
        && isStringInRange(input.authtoken, 1, 512)
        ? success<WebviewMessage>(input)
        : invalid('ngrok token payload is invalid');
    case 'action:save-airtable-pat':
      return hasExactKeys(input, ['type', 'id', 'pat'])
        && hasId()
        && isStringInRange(input.pat, 1, 512)
        ? success<WebviewMessage>(input)
        : invalid('Airtable PAT payload is invalid');
    case 'action:save-prompt':
      return hasExactKeys(input, ['type', 'id', 'prompt'])
        && hasId()
        && isPromptDef(input.prompt)
        ? success<WebviewMessage>(input)
        : invalid('prompt payload is invalid');
    case 'action:delete-prompt':
    case 'action:reset-prompt':
      return hasExactKeys(input, ['type', 'id', 'name'])
        && hasId()
        && typeof input.name === 'string'
        && PROMPT_NAME_PATTERN.test(input.name)
        ? success<WebviewMessage>(input)
        : invalid('prompt name is invalid');
    case 'confirmation:request':
      return hasExactKeys(input, ['type', 'id', 'kind'])
        && hasId()
        && input.kind === 'discard-prompt-edits'
        ? success<WebviewMessage>(input)
        : invalid('confirmation request is invalid');
    default:
      return invalid('unknown webview message type');
  }
}

function parseExtensionMessageByType(
  type: string,
  input: Record<string, unknown>,
): ParseResult<ExtensionMessage> {
  const invalid = (reason: string) => failure(reason, type);

  switch (type) {
    case 'state:update':
      return hasExactKeys(input, ['type', 'payload'])
        && isDashboardState(input.payload)
        ? success<ExtensionMessage>(input)
        : invalid('dashboard state is invalid');
    case 'ide:status':
      return hasExactKeys(input, ['type', 'payload'])
        && Array.isArray(input.payload)
        && input.payload.every(isIdeStatus)
        ? success<ExtensionMessage>(input)
        : invalid('IDE status payload is invalid');
    case 'auth:state':
      return hasExactKeys(input, ['type', 'payload'])
        && isAuthState(input.payload)
        ? success<ExtensionMessage>(input)
        : invalid('auth state payload is invalid');
    case 'action:result':
      return hasExactKeys(
        input,
        ['type', 'id', 'ok'],
        ['error', 'cancelled'],
      )
        && isActionId(input.id)
        && typeof input.ok === 'boolean'
        && hasOptional(input, 'error', value => typeof value === 'string')
        && hasOptional(input, 'cancelled', value => typeof value === 'boolean')
        ? success<ExtensionMessage>(input)
        : invalid('action result is invalid');
    case 'confirmation:result':
      return hasExactKeys(input, ['type', 'id', 'confirmed'])
        && isActionId(input.id)
        && typeof input.confirmed === 'boolean'
        ? success<ExtensionMessage>(input)
        : invalid('confirmation result is invalid');
    default:
      return invalid('unknown extension message type');
  }
}

export function parseWebviewMessage(input: unknown): ParseResult<WebviewMessage> {
  if (
    !isPlainRecord(input)
    || !Object.hasOwn(input, 'type')
    || typeof input.type !== 'string'
  ) {
    return failure('message must be a plain object with an own type');
  }

  return parseWebviewMessageByType(input.type, input);
}

export function parseExtensionMessage(
  input: unknown,
): ParseResult<ExtensionMessage> {
  if (
    !isPlainRecord(input)
    || !Object.hasOwn(input, 'type')
    || typeof input.type !== 'string'
  ) {
    return failure('message must be a plain object with an own type');
  }

  return parseExtensionMessageByType(input.type, input);
}
