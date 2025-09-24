const esbuild = require("esbuild");
const fs = require('fs');
const path = require('path');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
	name: 'esbuild-problem-matcher',

	setup(build) {
		build.onStart(() => {
			console.log('[watch] build started');
		});
		build.onEnd((result) => {
			result.errors.forEach(({ text, location }) => {
				console.error(`✘ [ERROR] ${text}`);
				if (location) {
					console.error(`    ${location.file}:${location.line}:${location.column}:`);
				}
			});
			console.log('[watch] build finished');
		});
	},
};

/** Copy src/vendor -> dist/vendor */
function copyDir(src, dest) {
	if (!fs.existsSync(src)) return;
	if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
	for (const entry of fs.readdirSync(src)) {
		const srcPath = path.join(src, entry);
		const destPath = path.join(dest, entry);
		const stat = fs.statSync(srcPath);
		if (stat.isDirectory()) {
			copyDir(srcPath, destPath);
		} else {
			fs.copyFileSync(srcPath, destPath);
		}
	}
}

/**
 * @type {import('esbuild').Plugin}
 */
const copyVendorPlugin = {
	name: 'copy-vendor',
	setup(build) {
		build.onEnd(() => {
			try {
				const srcVendor = path.join(__dirname, 'src', 'vendor');
				const outVendor = path.join(__dirname, 'dist', 'vendor');
				if (fs.existsSync(srcVendor)) {
					copyDir(srcVendor, outVendor);
					console.log('[copy] src/vendor -> dist/vendor');
				}
			} catch (e) {
				console.warn('[copy] vendor failed:', e);
			}
		});
	}
};

async function main() {
	const ctx = await esbuild.context({
		entryPoints: [
			'src/extension.ts'
		],
		bundle: true,
		format: 'cjs',
		minify: production,
		sourcemap: !production,
		sourcesContent: false,
		platform: 'node',
		outfile: 'dist/extension.js',
		external: ['vscode'],
		logLevel: 'silent',
		plugins: [
			/* add to the end of plugins array */
			esbuildProblemMatcherPlugin,
			copyVendorPlugin,
		],
	});
	if (watch) {
		await ctx.watch();
	} else {
		await ctx.rebuild();
		await ctx.dispose();
	}
}

main().catch(e => {
	console.error(e);
	process.exit(1);
});