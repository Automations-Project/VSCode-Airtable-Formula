import React from 'react';
import { Folder } from 'lucide-react';
import type { AiSkillClient } from '@shared/types.js';
import { IdeIcon, hasIdeIcon } from './IdeIcon.js';

/**
 * Decorative: every use sits beside the client's name. Our vendored logo when we
 * ship one (twelve ids), a folder for the standard skills folder, otherwise a neutral
 * monogram (no per-agent artwork, no hashed colours: it must survive every theme).
 */
export function AgentMark({ client }: { client: Pick<AiSkillClient, 'id' | 'name' | 'ideId'> }) {
  if (client.ideId && hasIdeIcon(client.ideId)) return <IdeIcon ideId={client.ideId} size={18} />;
  if (client.id === 'agents') return <Folder size={16} aria-hidden="true" />;
  return <span className="monogram" aria-hidden="true">{client.name.charAt(0).toUpperCase()}</span>;
}
