import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { IdeId, AiFiles, AiFileStatus } from '@airtable-formula/shared';
import { SKILL_CONTENT, RULE_CONTENT, WORKFLOWS, FUNCTIONS_REFERENCE, AGENTS_CONTENT } from './content.js';

interface AiInstallConfig {
  baseDir:   'home' | 'workspace';
  skillPath:    string | null;
  rulesPath:    string | null;
  workflowPath: string | null;
  agentsPath:   string | null;
  wrapCursor:   boolean;
}

const home = os.homedir();

const AI_CONFIGS: Record<IdeId, AiInstallConfig> = {
  'cursor': {
    baseDir: 'workspace',
    skillPath:    '.cursor/rules/airtable-formula-skill.mdc',
    rulesPath:    '.cursor/rules/airtable-formula-rules.mdc',
    workflowPath: '.cursor/rules/airtable-formula-workflow.mdc',
    agentsPath:   null,
    wrapCursor: true,
  },
  'windsurf': {
    baseDir: 'workspace',
    skillPath:    '.windsurf/skills/airtable-formula.md',
    rulesPath:    '.windsurf/rules/airtable-formula.md',
    workflowPath: '.windsurf/workflows/airtable-formula.md',
    agentsPath:   null,
    wrapCursor: false,
  },
  'windsurf-next': {
    baseDir: 'workspace',
    skillPath:    '.windsurf/skills/airtable-formula.md',
    rulesPath:    '.windsurf/rules/airtable-formula.md',
    workflowPath: '.windsurf/workflows/airtable-formula.md',
    agentsPath:   null,
    wrapCursor: false,
  },
  'claude-code': {
    baseDir: 'home',
    skillPath:    path.join(home, '.claude', 'skills', 'airtable-formula', 'SKILL.md'),
    rulesPath:    path.join(home, '.claude', 'skills', 'airtable-formula', 'RULES.md'),
    workflowPath: path.join(home, '.claude', 'skills', 'airtable-formula', 'WORKFLOWS.md'),
    agentsPath:   path.join(home, '.claude', 'skills', 'airtable-formula', 'AGENT.md'),
    wrapCursor: false,
  },
  'claude-desktop': { baseDir: 'home', skillPath: null, rulesPath: null, workflowPath: null, agentsPath: null, wrapCursor: false },
  'cline': {
    baseDir: 'workspace',
    skillPath:    '.clinerules/airtable-formula-skill.md',
    rulesPath:    '.clinerules/airtable-formula-rules.md',
    workflowPath: null,
    agentsPath:   null,
    wrapCursor: false,
  },
  'amp': {
    baseDir: 'workspace',
    skillPath:    null,
    rulesPath:    null,
    workflowPath: null,
    agentsPath:   null,
    wrapCursor: false,
  },
};

export function cursorWrap(content: string, description: string): string {
  return `---\ndescription: "${description}"\nglobs: ["**/*.formula"]\nalwaysApply: false\n---\n\n${content}`;
}

export async function writeIfMissing(filePath: string, content: string, force: boolean): Promise<boolean> {
  try { if (!force) { await fs.promises.access(filePath); return false; } } catch { /* missing, write it */ }
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.writeFile(filePath, content, 'utf8');
  return true;
}

function resolveBase(cfg: AiInstallConfig, workspaceRoot: string): string {
  return cfg.baseDir === 'home' ? home : workspaceRoot;
}

export async function installAiFiles(ideId: IdeId, workspaceRoot: string, force = false, includeAgents = false): Promise<AiFiles> {
  const cfg = AI_CONFIGS[ideId];
  const base = resolveBase(cfg, workspaceRoot);

  const written = async (rel: string | null, content: string): Promise<AiFileStatus> => {
    if (!rel) return 'missing';
    const abs = cfg.baseDir === 'home' ? rel : path.join(base, rel);
    try {
      await writeIfMissing(abs, content, force);
      return 'ok';
    } catch {
      return 'missing';
    }
  };

  const skillContent   = cfg.wrapCursor ? cursorWrap(SKILL_CONTENT, 'Airtable Formula skill') : SKILL_CONTENT;
  const rulesContent   = cfg.wrapCursor ? cursorWrap(RULE_CONTENT, 'Airtable Formula rules') : RULE_CONTENT;
  const wfContent      = cfg.wrapCursor ? cursorWrap(Object.values(WORKFLOWS).join('\n\n---\n\n'), 'Airtable Formula workflows') : Object.values(WORKFLOWS).join('\n\n---\n\n');
  const agentContent   = AGENTS_CONTENT;

  return {
    skills:    await written(cfg.skillPath, skillContent),
    rules:     await written(cfg.rulesPath, rulesContent),
    workflows: await written(cfg.workflowPath, wfContent),
    agents:    includeAgents ? await written(cfg.agentsPath, agentContent) : 'missing',
  };
}

export async function checkAiFiles(ideId: IdeId, workspaceRoot: string): Promise<AiFiles> {
  const cfg = AI_CONFIGS[ideId];
  const base = resolveBase(cfg, workspaceRoot);

  const check = async (rel: string | null): Promise<AiFileStatus> => {
    if (!rel) return 'missing';
    const abs = cfg.baseDir === 'home' ? rel : path.join(base, rel);
    try { await fs.promises.access(abs); return 'ok'; } catch { return 'missing'; }
  };

  return {
    skills:    await check(cfg.skillPath),
    rules:     await check(cfg.rulesPath),
    workflows: await check(cfg.workflowPath),
    agents:    await check(cfg.agentsPath),
  };
}
