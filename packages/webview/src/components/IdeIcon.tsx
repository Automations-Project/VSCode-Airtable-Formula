import React from 'react';
import type { IdeId } from '@shared/types.js';

import cursorSvg     from '../assets/icons/cursor.svg?raw';
import windsurfSvg   from '../assets/icons/windsurf.svg?raw';
import claudeCodeSvg from '../assets/icons/claude-code.svg?raw';
import claudeSvg     from '../assets/icons/claude.svg?raw';
import clineSvg      from '../assets/icons/cline.svg?raw';
import ampSvg        from '../assets/icons/amp.svg?raw';
import mcpSvg        from '../assets/icons/mcp.svg?raw';
import opencodeSvg   from '../assets/icons/opencode.svg?raw';
import codexCliSvg   from '../assets/icons/codex-cli.svg?raw';
import zedSvg        from '../assets/icons/zed.svg?raw';
import helixSvg      from '../assets/icons/helix.svg?raw';
import neovimSvg     from '../assets/icons/neovim.svg?raw';

const IDE_ICONS: Record<IdeId | 'mcp', string> = {
  'cursor':         cursorSvg,
  'windsurf':       windsurfSvg,
  'windsurf-next':  windsurfSvg,
  'claude-code':    claudeCodeSvg,
  'claude-desktop': claudeSvg,
  'cline':          clineSvg,
  'amp':            ampSvg,
  'opencode':       opencodeSvg,
  'codex-cli':      codexCliSvg,
  'zed':            zedSvg,
  'helix':          helixSvg,
  'neovim':         neovimSvg,
  'mcp':            mcpSvg,
};

export type IdeIconTone = 'default' | 'muted' | 'ok' | 'warn' | 'bad' | 'info';

interface IdeIconProps {
  ideId: IdeId | 'mcp';
  size?: number;
  tone?: IdeIconTone;
}

// The vendored artwork is static, style-free and script-free (a test scans every
// asset), so it is injected as shipped; only the 1em box becomes the requested size.
function sizedSvg(svg: string, size: number): string {
  return svg
    .replace(/width="1em"/g, `width="${size}"`)
    .replace(/height="1em"/g, `height="${size}"`);
}

/** Decorative: every use sits beside a text label. */
export function IdeIcon({ ideId, size = 16, tone = 'default' }: IdeIconProps) {
  const svg = IDE_ICONS[ideId];
  if (!svg) return null;

  return (
    <span
      className="ide-icon"
      data-tone={tone}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: sizedSvg(svg, size) }}
    />
  );
}
