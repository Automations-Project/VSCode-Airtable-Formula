/**
 * MCP prompts for Airtable — appear as slash commands in Claude Code,
 * Codex CLI, and any other MCP client that supports the prompts capability.
 */

export const PROMPTS = [
  {
    name: 'airtable-fix-formula',
    description: 'Debug and fix an Airtable formula error or unexpected result',
    arguments: [
      { name: 'formula',  description: 'The formula to fix',                     required: true  },
      { name: 'error',    description: 'Error message or symptom (e.g. #ERROR)', required: false },
      { name: 'appId',    description: 'Base ID (appXXX) to validate against',   required: false },
      { name: 'tableId',  description: 'Table ID (tblXXX) for field context',    required: false },
    ],
  },
  {
    name: 'airtable-create-formula',
    description: 'Create an Airtable formula from a plain-language description',
    arguments: [
      { name: 'description', description: 'What the formula should do',                  required: true  },
      { name: 'appId',       description: 'Base ID (appXXX) to look up field names',     required: false },
      { name: 'tableId',     description: 'Table ID (tblXXX) to look up field names',    required: false },
    ],
  },
  {
    name: 'airtable-inspect-base',
    description: 'Explore and summarise the schema of an Airtable base',
    arguments: [
      { name: 'appId', description: 'Base ID to inspect (appXXX)', required: true },
    ],
  },
  {
    name: 'airtable-setup-view',
    description: 'Configure an Airtable view — filters, sorts, groups, and column order',
    arguments: [
      { name: 'appId',        description: 'Base ID (appXXX)',                       required: true  },
      { name: 'tableId',      description: 'Table ID (tblXXX)',                      required: true  },
      { name: 'requirements', description: 'What the view should show and how',      required: false },
    ],
  },
  {
    name: 'airtable-validate-formula',
    description: 'Validate an Airtable formula and show its result type',
    arguments: [
      { name: 'formula', description: 'Formula text to validate',      required: true  },
      { name: 'appId',   description: 'Base ID (appXXX)',              required: true  },
      { name: 'tableId', description: 'Table ID (tblXXX, optional)',   required: false },
    ],
  },
];

/**
 * Render a prompt message for a given prompt name + arguments.
 * Returns { description, messages } compatible with GetPromptResult.
 */
export function renderPrompt(name, args = {}) {
  const a = (key, fallback = '') => (args[key] ?? fallback);

  switch (name) {
    case 'airtable-fix-formula': {
      const formula = a('formula');
      const error   = a('error');
      const appId   = a('appId');
      const tableId = a('tableId');

      let text = `You are an Airtable formula expert. Debug and fix the following formula.\n\n`;
      text += `**Formula:**\n\`\`\`\n${formula}\n\`\`\`\n\n`;
      if (error) text += `**Error / Symptom:** ${error}\n\n`;

      text += `**Steps:**\n`;
      text += `1. Identify the root cause (syntax error, wrong function, type mismatch, missing field braces, smart quotes, etc.)\n`;
      if (appId && tableId) {
        text += `2. Call \`list_fields\` with appId="${appId}", tableId="${tableId}" to verify all referenced field names exist and have the expected types\n`;
        text += `3. Call \`validate_formula\` with appId="${appId}", tableId="${tableId}" and the corrected formula text to confirm it is syntactically valid\n`;
        text += `4. Return the corrected formula and a brief explanation of what was wrong\n`;
      } else if (appId) {
        text += `2. Call \`validate_formula\` with appId="${appId}" and the corrected formula to confirm it is valid\n`;
        text += `3. Return the corrected formula and a brief explanation of what was wrong\n`;
      } else {
        text += `2. Apply the fix and explain what was wrong\n`;
        text += `3. Note: provide an appId and tableId next time for live validation via validate_formula\n`;
      }

      return {
        description: PROMPTS.find(p => p.name === name)?.description ?? name,
        messages: [{ role: 'user', content: { type: 'text', text } }],
      };
    }

    case 'airtable-create-formula': {
      const description = a('description');
      const appId   = a('appId');
      const tableId = a('tableId');

      let text = `You are an Airtable formula expert. Create a formula that does the following:\n\n`;
      text += `**Requirement:** ${description}\n\n`;
      text += `**Steps:**\n`;

      if (appId && tableId) {
        text += `1. Call \`list_fields\` with appId="${appId}", tableId="${tableId}" to discover available field names and their types\n`;
        text += `2. Draft the formula using correct Airtable syntax and the exact field names from the schema\n`;
        text += `3. Call \`validate_formula\` with appId="${appId}", tableId="${tableId}" to confirm the formula is valid and check its result type\n`;
        text += `4. Return the final formula with a brief explanation\n`;
      } else {
        text += `1. Draft the formula using correct Airtable syntax\n`;
        text += `2. Apply null-guards where values might be empty (e.g. \`IF({Field}="", "", ...)\`)\n`;
        text += `3. Explain field references used — the user should verify field names match their base exactly\n`;
        text += `4. Note: provide appId and tableId for live validation and accurate field name lookup\n`;
      }

      text += `\n**Airtable formula rules to follow:**\n`;
      text += `- Field names use curly braces: \`{Field Name}\`\n`;
      text += `- No comments (no \`//\` or \`/* */\`)\n`;
      text += `- Use straight quotes \`"\`, never smart/curly quotes\n`;
      text += `- Division needs a zero-guard: \`IF({Divisor}=0, BLANK(), {Numerator}/{Divisor})\`\n`;
      text += `- Use \`IF(ISERROR(expr), fallback, expr)\` for error handling\n`;

      return {
        description: PROMPTS.find(p => p.name === name)?.description ?? name,
        messages: [{ role: 'user', content: { type: 'text', text } }],
      };
    }

    case 'airtable-inspect-base': {
      const appId = a('appId');

      let text = `Inspect and summarise the Airtable base with ID: **${appId}**\n\n`;
      text += `**Steps:**\n`;
      text += `1. Call \`list_tables\` with appId="${appId}" to get an overview of all tables\n`;
      text += `2. Present a clear summary: table names, rough purpose (inferred from name), and table count\n`;
      text += `3. Ask the user if they want to drill into any specific table\n`;
      text += `4. For each table the user selects, call \`get_table_schema\` to show fields (name, type, and typeOptions for computed fields)\n`;
      text += `5. Highlight any formula fields and offer to explain or improve them\n`;

      return {
        description: PROMPTS.find(p => p.name === name)?.description ?? name,
        messages: [{ role: 'user', content: { type: 'text', text } }],
      };
    }

    case 'airtable-setup-view': {
      const appId        = a('appId');
      const tableId      = a('tableId');
      const requirements = a('requirements');

      let text = `Configure an Airtable view in base **${appId}**, table **${tableId}**.\n\n`;
      if (requirements) text += `**Requirements:** ${requirements}\n\n`;

      text += `**Steps:**\n`;
      text += `1. Call \`list_views\` with appId="${appId}", tableId="${tableId}" to see existing views\n`;
      text += `2. Call \`list_fields\` with appId="${appId}", tableId="${tableId}" to discover available fields and their IDs\n`;
      text += `3. Based on the requirements, decide whether to:\n`;
      text += `   - Create a new view (\`create_view\`) or modify an existing one\n`;
      text += `   - Apply filters (\`update_view_filters\`)\n`;
      text += `   - Apply sorts (\`apply_view_sorts\`)\n`;
      text += `   - Set grouping (\`update_view_group_levels\`)\n`;
      text += `   - Configure column visibility and order (\`set_view_columns\` for a full reset, or \`show_or_hide_view_columns\` + \`move_visible_columns\` for partial changes)\n`;
      text += `4. For column ordering, use \`set_view_columns\` when setting up from scratch — it hides all and shows only the specified IDs in the given order.\n`;
      text += `   When moving individual columns, make one call per column with incrementing \`targetVisibleIndex\` — the API ignores input array order.\n`;
      text += `5. Confirm changes with the user after each major step.\n`;

      return {
        description: PROMPTS.find(p => p.name === name)?.description ?? name,
        messages: [{ role: 'user', content: { type: 'text', text } }],
      };
    }

    case 'airtable-validate-formula': {
      const formula = a('formula');
      const appId   = a('appId');
      const tableId = a('tableId');

      let text = `Validate the following Airtable formula and report its result type.\n\n`;
      text += `**Formula:**\n\`\`\`\n${formula}\n\`\`\`\n\n`;
      text += `Call \`validate_formula\` with:\n`;
      text += `- appId: "${appId}"\n`;
      if (tableId) text += `- tableId: "${tableId}"\n`;
      text += `- formula: the formula text above\n\n`;
      text += `Report whether the formula is valid, what result type it produces, and any issues found.\n`;
      text += `If it is invalid, identify the error and suggest a corrected version.\n`;

      return {
        description: PROMPTS.find(p => p.name === name)?.description ?? name,
        messages: [{ role: 'user', content: { type: 'text', text } }],
      };
    }

    default:
      return {
        description: name,
        messages: [{ role: 'user', content: { type: 'text', text: `Unknown prompt: ${name}` } }],
      };
  }
}
