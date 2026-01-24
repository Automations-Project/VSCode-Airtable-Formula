import * as path from 'path';
import { runTests, downloadAndUnzipVSCode, resolveCliArgsFromVSCodeExecutablePath } from '@vscode/test-electron';
import * as cp from 'child_process';
import * as fs from 'fs';

async function main() {
  try {
    // The folder containing the Extension Manifest package.json
    const extensionDevelopmentPath = path.resolve(__dirname, '../../');

    // The path to the extension test script
    const extensionTestsPath = path.resolve(__dirname, './suite/index');

    // Check modes
    const keepOpen = process.argv.includes('--keep-open');
    const verbose = process.argv.includes('--verbose');

    if (keepOpen) {
      // Manual testing mode - launch VS Code and keep it open
      console.log('\n========================================')
      console.log('Launching VS Code for Manual Testing');
      console.log('========================================\n');
      console.log('Extension Path:', extensionDevelopmentPath);
      
      // Use examples folder as test workspace
      const testWorkspace = path.resolve(extensionDevelopmentPath, '../examples');
      console.log('Test Workspace:', testWorkspace);

      const manualTestLogPath = path.join(testWorkspace, '.airtable-formula-manual-test.log');
      try {
        fs.writeFileSync(manualTestLogPath, '', 'utf8');
      } catch {
      }
      console.log('Manual Test Log:', manualTestLogPath);
      console.log('\nVS Code will open with the examples folder.');
      console.log('You can test beautify/minify on the .formula files.');
      console.log('Logs will stream into this terminal and also be written to the log file above.');
      console.log('Close VS Code window when done.\n');
      
      // Download VS Code if needed
      const vscodeExecutablePath = await downloadAndUnzipVSCode('stable');
      const [cli, ...args] = resolveCliArgsFromVSCodeExecutablePath(vscodeExecutablePath);

      const escapeForPwshSingleQuotes = (value: string) => value.replace(/'/g, "''");
      const tailCmd = `Get-Content -Path '${escapeForPwshSingleQuotes(manualTestLogPath)}' -Wait -Tail 0`;
      const tailer = cp.spawn('powershell.exe', ['-NoProfile', '-Command', tailCmd], {
        stdio: 'inherit',
        shell: false,
      });

      // Launch VS Code with the extension loaded and test workspace
      const child = cp.spawn(
        cli,
        [
          ...args,
          '--wait',
          '--verbose',
          '--extensionDevelopmentPath=' + extensionDevelopmentPath,
          testWorkspace, // Open the examples folder
        ],
        {
          stdio: 'inherit',
          shell: true,
          detached: false,
          env: {
            ...process.env,
            AIRTABLE_FORMULA_MANUAL_TEST_LOG: manualTestLogPath,
          },
        }
      );

      child.on('error', (err) => {
        console.error('Failed to launch VS Code:', err);
        process.exit(1);
      });

      // Wait for the child process to exit
      await new Promise<void>((resolve) => {
        child.on('exit', (code) => {
          try {
            tailer.kill();
          } catch {
          }
          console.log('\nVS Code closed with exit code:', code);
          resolve();
        });
      });
    } else if (verbose) {
      // Verbose test mode - run tests with detailed output
      console.log('\n========================================')
      console.log('Running Extension Tests with Verbose Output');
      console.log('========================================\n');
      console.log('Extension Path:', extensionDevelopmentPath);
      console.log('Tests Path:', extensionTestsPath);
      console.log('\n');
      
      try {
        await runTests({ 
          extensionDevelopmentPath, 
          extensionTestsPath,
          launchArgs: [
            '--disable-extensions',
            '--disable-workspace-trust'
          ]
        });
        console.log('\n========================================')
        console.log('✓ All tests passed successfully!');
        console.log('========================================\n');
      } catch (err) {
        console.error('\n========================================')
        console.error('✗ Tests failed with errors:');
        console.error('========================================');
        console.error(err);
        console.error('\n');
        process.exit(1);
      }
    } else {
      // Run tests normally and exit
      await runTests({ extensionDevelopmentPath, extensionTestsPath });
    }
  } catch (err) {
    console.error('Failed to run tests:', err);
    process.exit(1);
  }
}

main();
