const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const packageRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(packageRoot, '..', '..');
const artifactsDir = path.resolve(repoRoot, 'artifacts');
const tempVsixPath = path.join(artifactsDir, 'airtable-formula.vsix');
const packageJsonPath = path.join(packageRoot, 'package.json');

function bumpVersion() {
	const packageRaw = fs.readFileSync(packageJsonPath, 'utf8');
	const versionMatch = packageRaw.match(/"version"\s*:\s*"(\d+\.\d+\.\d+)"/);
	const currentVersion = versionMatch?.[1]?.trim() ?? '';
	const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(currentVersion);

	if (!match) {
		throw new Error(`Unsupported version format: "${currentVersion}". Expected "x.y.z".`);
	}

	let major = Number(match[1]);
	let minor = Number(match[2]);
	let patch = Number(match[3]);

	patch += 1;
	if (patch >= 100) {
		patch = 0;
		minor += 1;
	}
	if (minor >= 100) {
		minor = 0;
		major += 1;
	}
	const nextVersion = `${major}.${minor}.${patch}`;

	const updatedRaw = packageRaw.replace(
		/"version"\s*:\s*"\d+\.\d+\.\d+"/,
		`"version": "${nextVersion}"`
	);

	fs.writeFileSync(packageJsonPath, updatedRaw, 'utf8');
	console.log(`[version] ${currentVersion} -> ${nextVersion}`);
	return nextVersion;
}

function run(cmd, args, cwd) {
	console.log(`[run] ${cmd} ${args.join(' ')}`);
	const result = spawnSync(cmd, args, {
		cwd,
		stdio: 'inherit',
		shell: process.platform === 'win32',
	});
	if (result.error) {
		console.error(result.error);
		process.exit(1);
	}
	if (result.status !== 0) {
		process.exit(result.status ?? 1);
	}
}

// ── 1. Auto-bump version ──
const shouldBump = !process.argv.includes('--no-bump');
if (shouldBump) {
	bumpVersion();
}

// ── 2. Full monorepo build ──
run('pnpm', ['-F', 'shared', 'build'], repoRoot);
run('pnpm', ['-F', 'webview', 'build'], repoRoot);
run('node', ['scripts/bundle-mcp.mjs'], repoRoot);
run('pnpm', ['-F', 'airtable-formula', 'build'], repoRoot);

// ── 3. Prepare deps & package VSIX ──
run('node', ['scripts/prepare-package-deps.mjs'], repoRoot);

// ── 3b. Copy root README, replacing SVGs (vsce rejects SVG in README) ──
const readmeSrc = path.join(repoRoot, 'README.md');
const readmeDst = path.join(packageRoot, 'README.md');
let readme = fs.readFileSync(readmeSrc, 'utf8');
// Replace Airtable SVG logo with the extension PNG icon
readme = readme.replace(
	/<img src="[^"]*airtable\.svg"[^/]*\/>/,
	'<img src="https://raw.githubusercontent.com/Automations-Project/VSCode-Airtable-Formula/main/packages/extension/images/icon.png" alt="Airtable Formula" width="80" />'
);
// Replace IDE icons table row (SVGs) with a plain text row
readme = readme.replace(
	/\| <img src="[^"]*claude\.svg"[^|]*\|[^\n]*\n/,
	'| Claude Desktop | Claude Code | Cursor | Windsurf | Cline | Amp |\n'
);
// Remove the MCP server icon SVG reference if present
readme = readme.replace(/<img src="[^"]*mcp\.svg"[^/]*\/>/g, '');
fs.writeFileSync(readmeDst, readme, 'utf8');
console.log(`[readme] ${readmeSrc} -> ${readmeDst} (SVGs replaced)`);

fs.mkdirSync(artifactsDir, { recursive: true });

const vsceCommand = process.platform === 'win32' ? 'vsce.cmd' : 'vsce';
const vsceResult = spawnSync(
	vsceCommand,
	['package', '--no-dependencies', '--out', tempVsixPath],
	{
		cwd: packageRoot,
		stdio: 'inherit',
		shell: process.platform === 'win32',
	}
);

if (vsceResult.error) {
	console.error(vsceResult.error);
	process.exit(1);
}
if (vsceResult.status !== 0) {
	process.exit(vsceResult.status ?? 1);
}

// ── 4. Rename with version ──
const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const version = typeof pkg.version === 'string' ? pkg.version.trim() : 'unknown';
const finalVsixPath = path.join(artifactsDir, `airtable-formula-${version}.vsix`);

if (fs.existsSync(finalVsixPath)) {
	fs.unlinkSync(finalVsixPath);
}

fs.renameSync(tempVsixPath, finalVsixPath);
console.log(`[vsix] ${finalVsixPath}`);
