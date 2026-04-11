const fs = require('node:fs');
const path = require('node:path');

const packagePath = path.resolve(__dirname, '..', 'package.json');
const packageRaw = fs.readFileSync(packagePath, 'utf8');
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

fs.writeFileSync(packagePath, updatedRaw, 'utf8');
console.log(`[version] ${currentVersion} -> ${nextVersion}`);
