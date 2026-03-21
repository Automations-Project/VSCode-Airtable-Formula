import React from 'react';
import type { IdeId } from '@shared/types.js';

import cursorSvg from '../assets/icons/cursor.svg?raw';
import windsurfSvg from '../assets/icons/windsurf.svg?raw';
import claudeCodeSvg from '../assets/icons/claude-code.svg?raw';
import claudeSvg from '../assets/icons/claude.svg?raw';
import clineSvg from '../assets/icons/cline.svg?raw';
import ampSvg from '../assets/icons/amp.svg?raw';
import mcpSvg from '../assets/icons/mcp.svg?raw';

const IDE_ICONS: Record<IdeId | 'mcp', string> = {
  'cursor': cursorSvg,
  'windsurf': windsurfSvg,
  'windsurf-next': windsurfSvg,
  'claude-code': claudeCodeSvg,
  'claude-desktop': claudeSvg,
  'cline': clineSvg,
  'amp': ampSvg,
  'mcp': mcpSvg,
};

interface IdeIconProps {
  ideId: IdeId | 'mcp';
  size?: number;
  color?: string;
}

export function IdeIcon({ ideId, size = 16, color }: IdeIconProps) {
  const svg = IDE_ICONS[ideId];
  if (!svg) return null;

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        color: color ?? 'var(--fg-subtle)',
        flexShrink: 0,
      }}
      dangerouslySetInnerHTML={{
        __html: svg.replace(/width="1em"/g, `width="${size}"`).replace(/height="1em"/g, `height="${size}"`),
      }}
    />
  );
}
