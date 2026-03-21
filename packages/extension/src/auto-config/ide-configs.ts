import * as os from 'os';
import * as path from 'path';
import type { IdeId } from '@airtable-formula/shared';

export interface IdeConfig {
  label:          string;
  mcpConfigPath:  string;
  mcpServersKey:  string;
  detectionPaths: string[];
}

const home = os.homedir();
const appData = process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming');

export const IDE_CONFIGS: Record<IdeId, IdeConfig> = {
  'cursor': {
    label: 'Cursor',
    mcpConfigPath: path.join(home, '.cursor', 'mcp.json'),
    mcpServersKey: 'mcpServers',
    detectionPaths: [
      path.join(home, '.cursor'),
      '/Applications/Cursor.app',
      'C:\\Users\\' + (process.env.USERNAME ?? '') + '\\AppData\\Local\\Programs\\cursor',
    ],
  },
  'windsurf': {
    label: 'Windsurf',
    mcpConfigPath: path.join(home, '.codeium', 'windsurf', 'mcp_config.json'),
    mcpServersKey: 'mcpServers',
    detectionPaths: [path.join(home, '.codeium', 'windsurf')],
  },
  'windsurf-next': {
    label: 'Windsurf Next',
    mcpConfigPath: path.join(home, '.codeium', 'windsurf-next', 'mcp_config.json'),
    mcpServersKey: 'mcpServers',
    detectionPaths: [path.join(home, '.codeium', 'windsurf-next')],
  },
  'claude-code': {
    label: 'Claude Code',
    mcpConfigPath: path.join(home, '.claude.json'),
    mcpServersKey: 'mcpServers',
    detectionPaths: [path.join(home, '.claude.json'), path.join(home, '.claude')],
  },
  'claude-desktop': {
    label: 'Claude Desktop',
    mcpConfigPath: process.platform === 'win32'
      ? path.join(appData, 'Claude', 'claude_desktop_config.json')
      : path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'),
    mcpServersKey: 'mcpServers',
    detectionPaths: [
      path.join(appData, 'Claude'),
      path.join(home, 'Library', 'Application Support', 'Claude'),
    ],
  },
  'cline': {
    label: 'Cline',
    mcpConfigPath: path.join(home, '.cline', 'data', 'settings', 'cline_mcp_settings.json'),
    mcpServersKey: 'mcpServers',
    detectionPaths: [path.join(home, '.cline')],
  },
  'amp': {
    label: 'Amp',
    mcpConfigPath: path.join(home, '.config', 'amp', 'settings.json'),
    mcpServersKey: 'mcp.servers',
    detectionPaths: [path.join(home, '.config', 'amp')],
  },
};
