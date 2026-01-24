import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';

suite('Beautifier Test Suite', () => {
    const vendorPath = path.resolve(__dirname, '../../../src/vendor');
    
    test('Beautifier v2 should handle NOW() and TODAY()', () => {
        const beautifierPath = path.join(vendorPath, 'formula-beautifier-v2.js');
        const beautifierCode = fs.readFileSync(beautifierPath, 'utf8');
        
        // Verify NOW and TODAY are in the FUNCTIONS set
        assert.ok(beautifierCode.includes("'NOW'"), 'NOW should be in FUNCTIONS');
        assert.ok(beautifierCode.includes("'TODAY'"), 'TODAY should be in FUNCTIONS');
    });
    
    test('Beautifier v2 should handle smart quotes', () => {
        const beautifierPath = path.join(vendorPath, 'formula-beautifier-v2.js');
        const beautifierCode = fs.readFileSync(beautifierPath, 'utf8');
        
        // Verify smart quotes handling exists
        assert.ok(beautifierCode.includes('\\u201C'), 'Should handle left double smart quote');
        assert.ok(beautifierCode.includes('\\u201D'), 'Should handle right double smart quote');
    });
    
    test('Beautifier v2 should handle line breaks', () => {
        const beautifierPath = path.join(vendorPath, 'formula-beautifier-v2.js');
        const beautifierCode = fs.readFileSync(beautifierPath, 'utf8');
        
        // Verify line break handling
        assert.ok(beautifierCode.includes("'\\\\n'"), 'Should handle line break character');
    });
    
    test('Minifier v2 should have correct CONSTANTS', () => {
        const minifierPath = path.join(vendorPath, 'formula-minifier-v2.js');
        const minifierCode = fs.readFileSync(minifierPath, 'utf8');
        
        // Verify CONSTANTS only has TRUE and FALSE
        const constantsMatch = minifierCode.match(/const CONSTANTS = new Set\(\[(.*?)\]\)/s);
        assert.ok(constantsMatch, 'Should find CONSTANTS definition');
        
        const constants = constantsMatch![1];
        assert.ok(constants.includes("'TRUE'"), 'Should include TRUE');
        assert.ok(constants.includes("'FALSE'"), 'Should include FALSE');
        assert.ok(!constants.includes("'NOW'"), 'Should NOT include NOW in CONSTANTS');
        assert.ok(!constants.includes("'TODAY'"), 'Should NOT include TODAY in CONSTANTS');
    });
    
    test('Minifier v2 should have NOW and TODAY in FUNCTIONS', () => {
        const minifierPath = path.join(vendorPath, 'formula-minifier-v2.js');
        const minifierCode = fs.readFileSync(minifierPath, 'utf8');
        
        // Verify NOW and TODAY are in FUNCTIONS
        assert.ok(minifierCode.includes("'NOW'"), 'NOW should be in FUNCTIONS');
        assert.ok(minifierCode.includes("'TODAY'"), 'TODAY should be in FUNCTIONS');
    });
    
    test('Minifier v2 should only have official record functions', () => {
        const minifierPath = path.join(vendorPath, 'formula-minifier-v2.js');
        const minifierCode = fs.readFileSync(minifierPath, 'utf8');
        
        // Verify only official record functions
        assert.ok(minifierCode.includes("'RECORD_ID'"), 'Should include RECORD_ID');
        assert.ok(minifierCode.includes("'CREATED_TIME'"), 'Should include CREATED_TIME');
        assert.ok(minifierCode.includes("'LAST_MODIFIED_TIME'"), 'Should include LAST_MODIFIED_TIME');
        
        // Verify non-official functions are removed
        const recordSection = minifierCode.match(/\/\/ Record functions\s+(.*?)(?=\]\);)/s);
        if (recordSection) {
            assert.ok(!recordSection[1].includes("'AUTONUMBER'"), 'Should NOT include AUTONUMBER');
            assert.ok(!recordSection[1].includes("'CREATED_BY'"), 'Should NOT include CREATED_BY');
            assert.ok(!recordSection[1].includes("'LAST_MODIFIED_BY'"), 'Should NOT include LAST_MODIFIED_BY');
        }
    });

    test('Beautifier v2 JSON style should line-break long concatenations', () => {
        const beautifierPath = path.join(vendorPath, 'formula-beautifier-v2.js');
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const BeautifierClass = require(beautifierPath);
        const beautifier = new BeautifierClass({ style: 'json', max_line_length: 10 });

        const formula = '"{" & "{\\"a\\":\\"b\\"}" & "}"';
        const result = beautifier.beautify(formula);

        assert.ok(result.includes('\n  & '), 'Expected JSON concatenation to break onto new lines');
    });

    test('Beautifier v2 should handle deep concatenation chains', () => {
        const beautifierPath = path.join(vendorPath, 'formula-beautifier-v2.js');
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const BeautifierClass = require(beautifierPath);
        const beautifier = new BeautifierClass({ style: 'json', max_line_length: 20 });

        const parts = Array.from({ length: 200 }, () => '"{"');
        parts.push('"}"');
        const formula = parts.join(' & ');
        const result = beautifier.beautify(formula);

        assert.ok(result.length > 0, 'Expected beautifier to return output for deep concatenation');
    });

    test('Minify command should detect already-minified targets', () => {
        const minifyCmdPath = path.resolve(__dirname, '../../../src/commands/minifyWithLevel.ts');
        const minifyCmdCode = fs.readFileSync(minifyCmdPath, 'utf8');

        assert.ok(minifyCmdCode.includes('min.formula'), 'Expected minify command to handle .min.formula');
        assert.ok(minifyCmdCode.includes('ultra-min.formula'), 'Expected minify command to handle .ultra-min.formula');
        assert.ok(minifyCmdCode.includes('isMinifiedTarget'), 'Expected minify command to detect minified targets');
    });
});
