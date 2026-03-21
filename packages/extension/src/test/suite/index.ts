import * as path from 'path';
import Mocha from 'mocha';
import { glob } from 'glob';

export async function run(): Promise<void> {
  // Create the mocha test with verbose reporter
  const mocha = new Mocha({
    ui: 'tdd',
    color: true,
    reporter: 'spec', // Use spec reporter for detailed output
    timeout: 10000, // 10 second timeout
    slow: 2000 // Mark tests as slow if they take more than 2s
  });

  const testsRoot = path.resolve(__dirname, '..');

  console.log('\n📁 Searching for test files in:', testsRoot);
  const files = await glob('**/**.test.js', { cwd: testsRoot });
  console.log(`\n✓ Found ${files.length} test file(s):`);
  files.forEach((f: string) => console.log(`  - ${f}`));
  console.log('\n');

  // Add files to the test suite
  files.forEach((f: string) => mocha.addFile(path.resolve(testsRoot, f)));

  // Run the mocha test
  return new Promise((resolve, reject) => {
    try {
      const runner = mocha.run((failures: number) => {
        console.log('\n');
        if (failures > 0) {
          console.error(`❌ ${failures} test(s) failed\n`);
          reject(new Error(`${failures} tests failed.`));
        } else {
          console.log('✅ All tests passed\n');
          resolve();
        }
      });

      // Log each test as it runs
      runner.on('test', (test) => {
        console.log(`\n▶ Running: ${test.fullTitle()}`);
      });

      runner.on('pass', (test) => {
        console.log(`  ✓ Passed (${test.duration}ms)`);
      });

      runner.on('fail', (test, err) => {
        console.error(`  ✗ Failed: ${test.fullTitle()}`);
        console.error(`    Error: ${err.message}`);
        if (err.stack) {
          console.error(`    Stack: ${err.stack}`);
        }
      });
    } catch (err) {
      console.error('Error running tests:', err);
      reject(err);
    }
  });
}
