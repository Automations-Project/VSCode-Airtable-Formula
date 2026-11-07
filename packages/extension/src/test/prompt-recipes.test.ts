import { describe, it, expect } from 'vitest';
import { renderPromptRecipes, RECIPES_FILE } from '../skills/prompt-recipes.js';

const recipe = { name: 'airtable-fix-formula', description: 'Debug it', arguments: [
  { name: 'formula', description: 'The formula', required: true },
  { name: 'error', description: 'Symptom', required: false },
], template: 'Fix {formula}\n\nSymptom: {error}' };

describe('renderPromptRecipes', () => {
  it('renders the header, one section per prompt, inputs and the template verbatim', () => {
    const md = renderPromptRecipes([recipe]);
    expect(md.startsWith('# Airtable task recipes\n')).toBe(true);
    expect(md).toContain('\n## airtable-fix-formula\n\nDebug it\n\nInputs:\n- `formula` (required): The formula\n- `error` (optional): Symptom\n\nRecipe:\n\nFix {formula}\n\nSymptom: {error}\n');
  });

  it('prints "Inputs: none" for a prompt without arguments', () => {
    expect(renderPromptRecipes([{ ...recipe, arguments: [] }])).toContain('\nInputs: none\n');
  });

  it('single-lines a hostile name before it becomes a heading', () => {
    const md = renderPromptRecipes([{ ...recipe, name: '# evil\n\n## injected' }]);
    expect(md).toContain('\n## evil ## injected\n');
    expect(md).not.toContain('\n## injected\n');
  });

  it('single-lines the description and every input, so none of them opens a heading', () => {
    const md = renderPromptRecipes([{
      ...recipe,
      description: 'Debug it\n\n## airtable-fix-formula',
      arguments: [{ name: 'formula\n## x', description: 'The formula\n\n# heading', required: true }],
    }]);
    expect(md.match(/^#{1,6} /gm)).toEqual(['# ', '## ']);   // the file title and this recipe's own heading
    expect(md).toContain('\n\nDebug it ## airtable-fix-formula\n\n');
    expect(md).toContain('\n- `formula ## x` (required): The formula # heading\n');
  });

  it('strips a leading # from a description', () => {
    expect(renderPromptRecipes([{ ...recipe, description: '## Not a heading' }])).toContain('\n\nNot a heading\n\n');
  });

  it('keeps prompt order', () => {
    const md = renderPromptRecipes([recipe, { ...recipe, name: 'second' }]);
    expect(md.indexOf('## airtable-fix-formula')).toBeLessThan(md.indexOf('## second'));
  });

  it('names the file', () => { expect(RECIPES_FILE).toBe('references/prompts.md'); });
});
