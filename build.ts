import * as esbuild from 'esbuild';
import { cpSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

const esbuildProblemMatcherPlugin: esbuild.Plugin = {
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

const copyVendorPlugin: esbuild.Plugin = {
    name: 'copy-vendor',
    setup(build) {
        build.onEnd(() => {
            try {
                const srcVendor = join(__dirname, 'src', 'vendor');
                const outVendor = join(__dirname, 'dist', 'vendor');
                if (existsSync(srcVendor)) {
                    if (!existsSync(outVendor)) {
                        mkdirSync(outVendor, { recursive: true });
                    }
                    cpSync(srcVendor, outVendor, { recursive: true });
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
        entryPoints: ['src/extension.ts'],
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
            esbuildProblemMatcherPlugin,
            copyVendorPlugin,
        ],
    });

    if (watch) {
        await ctx.watch();
        console.log('[watch] watching for changes...');
    } else {
        await ctx.rebuild();
        await ctx.dispose();
    }
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});
