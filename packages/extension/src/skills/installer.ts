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
  /**
   * Deprecated-but-still-honored paths written alongside the primary ones and
   * recognized on check. Used when a client rebrands its config directory but
   * keeps reading the old one — e.g. Windsurf → Devin Desktop (2026-06-02):
   * primary `.devin/…`, legacy `.windsurf/…` (read by Devin's on-by-default
   * Windsurf import + by users still on pre-rebrand Windsurf).
   */
  legacy?: {
    skillPath?:    string;
    rulesPath?:    string;
    workflowPath?: string;
  };
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
    // Windsurf was rebranded to "Devin Desktop" (2026-06-02). Devin-native
    // workspace assets live under .devin/; .windsurf/ is still read as legacy.
    skillPath:    '.devin/skills/airtable-formula.md',
    rulesPath:    '.devin/rules/airtable-formula.md',
    workflowPath: '.devin/workflows/airtable-formula.md',
    agentsPath:   null,
    wrapCursor: false,
    legacy: {
      skillPath:    '.windsurf/skills/airtable-formula.md',
      rulesPath:    '.windsurf/rules/airtable-formula.md',
      workflowPath: '.windsurf/workflows/airtable-formula.md',
    },
  },
  'windsurf-next': {
    baseDir: 'workspace',
    skillPath:    '.devin/skills/airtable-formula.md',
    rulesPath:    '.devin/rules/airtable-formula.md',
    workflowPath: '.devin/workflows/airtable-formula.md',
    agentsPath:   null,
    wrapCursor: false,
    legacy: {
      skillPath:    '.windsurf/skills/airtable-formula.md',
      rulesPath:    '.windsurf/rules/airtable-formula.md',
      workflowPath: '.windsurf/workflows/airtable-formula.md',
    },
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
  // CLI tools and LSP-only editors — no AI files concept
  'opencode':  { baseDir: 'home', skillPath: null, rulesPath: null, workflowPath: null, agentsPath: null, wrapCursor: false },
  'codex-cli': { baseDir: 'home', skillPath: null, rulesPath: null, workflowPath: null, agentsPath: null, wrapCursor: false },
  'zed':       { baseDir: 'home', skillPath: null, rulesPath: null, workflowPath: null, agentsPath: null, wrapCursor: false },
  'helix':     { baseDir: 'home', skillPath: null, rulesPath: null, workflowPath: null, agentsPath: null, wrapCursor: false },
  'neovim':    { baseDir: 'home', skillPath: null, rulesPath: null, workflowPath: null, agentsPath: null, wrapCursor: false },
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

  // Write the primary path and any legacy paths (e.g. .devin/ + .windsurf/).
  // 'ok' if at least one location ends up present.
  const written = async (rel: string | null, legacyRel: string | undefined, content: string): Promise<AiFileStatus> => {
    if (!rel) return 'missing';
    let present = false;
    for (const r of [rel, legacyRel]) {
      if (!r) continue;
      const abs = cfg.baseDir === 'home' ? r : path.join(base, r);
      try {
        await writeIfMissing(abs, content, force);
        present = true;
      } catch { /* skip this location */ }
    }
    return present ? 'ok' : 'missing';
  };

  const skillContent   = cfg.wrapCursor ? cursorWrap(SKILL_CONTENT, 'Airtable Formula skill') : SKILL_CONTENT;
  const rulesContent   = cfg.wrapCursor ? cursorWrap(RULE_CONTENT, 'Airtable Formula rules') : RULE_CONTENT;
  const wfContent      = cfg.wrapCursor ? cursorWrap(Object.values(WORKFLOWS).join('\n\n---\n\n'), 'Airtable Formula workflows') : Object.values(WORKFLOWS).join('\n\n---\n\n');
  const agentContent   = AGENTS_CONTENT;

  return {
    skills:    await written(cfg.skillPath, cfg.legacy?.skillPath, skillContent),
    rules:     await written(cfg.rulesPath, cfg.legacy?.rulesPath, rulesContent),
    workflows: await written(cfg.workflowPath, cfg.legacy?.workflowPath, wfContent),
    agents:    includeAgents ? await written(cfg.agentsPath, undefined, agentContent) : 'missing',
  };
}

export async function checkAiFiles(ideId: IdeId, workspaceRoot: string): Promise<AiFiles> {
  const cfg = AI_CONFIGS[ideId];
  const base = resolveBase(cfg, workspaceRoot);

  // 'ok' if the primary OR any legacy path exists.
  const check = async (rel: string | null, legacyRel?: string): Promise<AiFileStatus> => {
    for (const r of [rel, legacyRel]) {
      if (!r) continue;
      const abs = cfg.baseDir === 'home' ? r : path.join(base, r);
      try { await fs.promises.access(abs); return 'ok'; } catch { /* keep checking */ }
    }
    return 'missing';
  };

  return {
    skills:    await check(cfg.skillPath, cfg.legacy?.skillPath),
    rules:     await check(cfg.rulesPath, cfg.legacy?.rulesPath),
    workflows: await check(cfg.workflowPath, cfg.legacy?.workflowPath),
    agents:    await check(cfg.agentsPath),
  };
}
