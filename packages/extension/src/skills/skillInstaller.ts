import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { SKILL_CONTENT, RULE_CONTENT, WORKFLOWS, FUNCTIONS_REFERENCE, MCP_TOOLS_GUIDE, MCP_RULES } from './templates/skillTemplates';

/**
 * IDE types supported by the skill installer
 * Based on: Research/ide-ai-rules-paths.md
 */
type IDEType = 'windsurf' | 'cursor' | 'vscode' | 'claude' | 'unknown';

/**
 * IDE configuration for skill installation paths
 */
interface IDEConfig {
    skillFolder: string;
    rulesFolder: string;
    ruleFileName: string;
    workflowsFolder: string;
    workflowExtension: string;
}

const IDE_CONFIGS: Record<IDEType, IDEConfig> = {
    // Windsurf: .windsurf/rules/*.md, .windsurf/workflows/*.md, .windsurf/skills/*.md
    windsurf: {
        skillFolder: '.windsurf/skills',
        rulesFolder: '.windsurf/rules',
        ruleFileName: 'airtable-formula.md',
        workflowsFolder: '.windsurf/workflows',
        workflowExtension: '.md'
    },
    // Cursor: .cursor/rules/*.mdc with YAML frontmatter
    cursor: {
        skillFolder: '.cursor/rules',  // Cursor uses rules folder for skills too
        rulesFolder: '.cursor/rules',
        ruleFileName: 'airtable-formula.mdc',
        workflowsFolder: '.cursor/rules',  // Cursor puts workflows in rules
        workflowExtension: '.mdc'
    },
    // VS Code: .github/instructions/*.instructions.md or .vscode/
    vscode: {
        skillFolder: '.github/instructions',
        rulesFolder: '.github/instructions',
        ruleFileName: 'airtable-formula.instructions.md',
        workflowsFolder: '.github/instructions',
        workflowExtension: '.instructions.md'
    },
    // Claude Code: ~/.claude/skills/<skill-name>/SKILL.md (global, not workspace)
    // Also installs to ~/.codex/skills/ for Codex compatibility
    claude: {
        skillFolder: '.claude/skills/airtable-formula',  // Will be resolved to home dir
        rulesFolder: '.claude/skills/airtable-formula',
        ruleFileName: 'RULES.md',
        workflowsFolder: '.claude/skills/airtable-formula',
        workflowExtension: '.md'
    },
    // Fallback for unknown IDEs
    unknown: {
        skillFolder: '.ai/skills',
        rulesFolder: '.ai/rules',
        ruleFileName: 'airtable-formula.md',
        workflowsFolder: '.ai/workflows',
        workflowExtension: '.md'
    }
};

/**
 * Detects which IDE is running based on environment and app name
 */
export function detectIDE(): IDEType {
    const appName = vscode.env.appName.toLowerCase();
    
    if (appName.includes('windsurf')) {
        return 'windsurf';
    } else if (appName.includes('cursor')) {
        return 'cursor';
    } else if (appName.includes('claude')) {
        return 'claude';
    } else if (appName.includes('code') || appName.includes('visual studio')) {
        return 'vscode';
    }
    
    return 'unknown';
}

/**
 * Ensures a directory exists, creating it recursively if needed
 */
async function ensureDir(dirPath: string): Promise<void> {
    try {
        await fs.promises.mkdir(dirPath, { recursive: true });
    } catch (err) {
        // Directory might already exist
    }
}

/**
 * Writes content to a file, creating parent directories as needed
 */
async function writeFile(filePath: string, content: string): Promise<void> {
    await ensureDir(path.dirname(filePath));
    await fs.promises.writeFile(filePath, content, 'utf8');
}

/**
 * Wraps content with Cursor .mdc YAML frontmatter
 */
function wrapWithMdcFrontmatter(content: string, description: string, globs: string[], alwaysApply: boolean = false): string {
    const frontmatter = `---
description: "${description}"
globs: ${JSON.stringify(globs)}
alwaysApply: ${alwaysApply}
---

`;
    return frontmatter + content;
}

/**
 * Installs skills for Claude Code to global directories
 * Claude Code uses: ~/.claude/skills/<skill-name>/SKILL.md
 * Also installs to ~/.codex/skills/ for Codex compatibility
 */
async function installClaudeSkills(force: boolean): Promise<void> {
    const homeDir = os.homedir();
    const claudeSkillDir = path.join(homeDir, '.claude', 'skills', 'airtable-formula');
    const codexSkillDir = path.join(homeDir, '.codex', 'skills', 'airtable-formula');
    
    // Install to both Claude and Codex directories
    for (const skillDir of [claudeSkillDir, codexSkillDir]) {
        // Install main skill file (SKILL.md is the required name for Claude)
        const skillPath = path.join(skillDir, 'SKILL.md');
        if (force || !(await fileExists(skillPath))) {
            await writeFile(skillPath, SKILL_CONTENT);
        }
        
        // Install functions reference
        const functionsPath = path.join(skillDir, 'functions-reference.md');
        if (force || !(await fileExists(functionsPath))) {
            await writeFile(functionsPath, FUNCTIONS_REFERENCE);
        }
        
        // Install rules
        const rulesPath = path.join(skillDir, 'RULES.md');
        if (force || !(await fileExists(rulesPath))) {
            await writeFile(rulesPath, RULE_CONTENT);
        }
        
        // Install workflows
        for (const [name, content] of Object.entries(WORKFLOWS)) {
            const workflowPath = path.join(skillDir, `${name}.md`);
            if (force || !(await fileExists(workflowPath))) {
                await writeFile(workflowPath, content);
            }
        }
        
        // Install MCP tools guide
        const mcpGuidePath = path.join(skillDir, 'mcp-tools-guide.md');
        if (force || !(await fileExists(mcpGuidePath))) {
            await writeFile(mcpGuidePath, MCP_TOOLS_GUIDE);
        }
        
        // Install MCP rules
        const mcpRulesPath = path.join(skillDir, 'MCP-RULES.md');
        if (force || !(await fileExists(mcpRulesPath))) {
            await writeFile(mcpRulesPath, MCP_RULES);
        }
    }
    
    vscode.window.showInformationMessage(
        `Airtable Formula AI skills installed to ~/.claude/skills/ and ~/.codex/skills/`
    );
}

/**
 * Checks if a file exists
 */
async function fileExists(filePath: string): Promise<boolean> {
    try {
        await fs.promises.access(filePath);
        return true;
    } catch {
        return false;
    }
}

/**
 * Installs the Airtable Formula skill, rules, and workflows to the workspace
 * For Claude Code: installs to ~/.claude/skills/ and ~/.codex/skills/ (global)
 */
export async function installSkills(force: boolean = false): Promise<void> {
    const ide = detectIDE();
    const config = IDE_CONFIGS[ide];
    
    // Claude Code uses global paths (home directory), not workspace
    if (ide === 'claude') {
        await installClaudeSkills(force);
        return;
    }
    
    // For other IDEs, install to workspace
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        return; // No workspace open
    }
    
    const workspaceRoot = workspaceFolders[0].uri.fsPath;
    
    // Install skill file
    const skillFileName = ide === 'cursor' ? 'airtable-formula-skill.mdc' : 'airtable-formula-skill.md';
    const skillPath = path.join(workspaceRoot, config.skillFolder, skillFileName);
    if (force || !(await fileExists(skillPath))) {
        const skillContent = ide === 'cursor' ? wrapWithMdcFrontmatter(SKILL_CONTENT, 'Airtable Formula skill', ['**/*.formula']) : SKILL_CONTENT;
        await writeFile(skillPath, skillContent);
    }
    
    // Install functions reference
    const funcFileName = ide === 'cursor' ? 'airtable-functions.mdc' : 'airtable-functions.md';
    const functionsPath = path.join(workspaceRoot, config.skillFolder, funcFileName);
    if (force || !(await fileExists(functionsPath))) {
        const funcContent = ide === 'cursor' ? wrapWithMdcFrontmatter(FUNCTIONS_REFERENCE, 'Airtable functions reference', ['**/*.formula']) : FUNCTIONS_REFERENCE;
        await writeFile(functionsPath, funcContent);
    }
    
    // Install rule (always-on)
    const rulePath = path.join(workspaceRoot, config.rulesFolder, config.ruleFileName);
    if (force || !(await fileExists(rulePath))) {
        const ruleContent = ide === 'cursor' ? wrapWithMdcFrontmatter(RULE_CONTENT, 'Airtable Formula rules', ['**/*.formula'], true) : RULE_CONTENT;
        await writeFile(rulePath, ruleContent);
    }
    
    // Install workflows
    for (const [name, content] of Object.entries(WORKFLOWS)) {
        const workflowPath = path.join(workspaceRoot, config.workflowsFolder, `${name}${config.workflowExtension}`);
        if (force || !(await fileExists(workflowPath))) {
            const workflowContent = ide === 'cursor' ? wrapWithMdcFrontmatter(content, name.replace(/-/g, ' '), ['**/*.formula']) : content;
            await writeFile(workflowPath, workflowContent);
        }
    }
    
    // Install MCP tools guide
    const mcpGuideFileName = ide === 'cursor' ? 'airtable-mcp-tools.mdc' : 'airtable-mcp-tools.md';
    const mcpGuidePath = path.join(workspaceRoot, config.skillFolder, mcpGuideFileName);
    if (force || !(await fileExists(mcpGuidePath))) {
        const mcpGuideContent = ide === 'cursor' ? wrapWithMdcFrontmatter(MCP_TOOLS_GUIDE, 'Airtable MCP tools guide', ['**/*']) : MCP_TOOLS_GUIDE;
        await writeFile(mcpGuidePath, mcpGuideContent);
    }
    
    // Install MCP rules (always-on)
    const mcpRuleFileName = ide === 'cursor' ? 'airtable-mcp-rules.mdc' : (ide === 'vscode' ? 'airtable-mcp-rules.instructions.md' : 'airtable-mcp-rules.md');
    const mcpRulePath = path.join(workspaceRoot, config.rulesFolder, mcpRuleFileName);
    if (force || !(await fileExists(mcpRulePath))) {
        const mcpRuleContent = ide === 'cursor' ? wrapWithMdcFrontmatter(MCP_RULES, 'Airtable MCP tool usage rules', ['**/*'], true) : MCP_RULES;
        await writeFile(mcpRulePath, mcpRuleContent);
    }
    
    vscode.window.showInformationMessage(
        `Airtable Formula AI skills installed for ${ide === 'unknown' ? 'your IDE' : ide}`
    );
}

/**
 * Removes installed skills from the workspace
 */
export async function uninstallSkills(): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        return;
    }
    
    const workspaceRoot = workspaceFolders[0].uri.fsPath;
    const ide = detectIDE();
    const config = IDE_CONFIGS[ide];
    
    const skillFolder = path.join(workspaceRoot, config.skillFolder);
    
    try {
        await fs.promises.rm(skillFolder, { recursive: true, force: true });
        vscode.window.showInformationMessage('Airtable Formula AI skills removed');
    } catch {
        // Folder might not exist
    }
}

/**
 * Registers skill-related commands
 */
export function registerSkillCommands(context: vscode.ExtensionContext): void {
    // Command to install/reinstall skills
    context.subscriptions.push(
        vscode.commands.registerCommand('airtable-formula.installAISkills', () => {
            installSkills(true);
        })
    );
    
    // Command to uninstall skills
    context.subscriptions.push(
        vscode.commands.registerCommand('airtable-formula.uninstallAISkills', () => {
            uninstallSkills();
        })
    );
}
