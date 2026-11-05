import React from 'react';
import type { NavigateFn } from '../../components/NextAction.js';
import { Section } from '../../components/Section.js';
import { useStore } from '../../store.js';

interface OverviewLinksProps {
  navigate: NavigateFn;
}

export function OverviewLinks({ navigate }: OverviewLinksProps) {
  const profile = useStore(s => s.settings.mcp.toolProfile.profile);
  const enabledCount = useStore(s => s.settings.mcp.toolProfile.enabledCount);
  const totalCount = useStore(s => s.settings.mcp.toolProfile.totalCount);
  const promptCount = useStore(s => s.prompts?.prompts.length ?? 0);

  return (
    <Section id="overview-links" title="Jump to">
      <ul className="link-list">
        <li>
          <button type="button" className="overview-link" onClick={() => navigate('setup', 'local-service-heading')}>
            <span className="overview-link__title">Editors and local service</span>
            <span className="overview-link__detail">Connect editors, install AI files, manage remote access</span>
          </button>
        </li>
        <li>
          <button type="button" className="overview-link" onClick={() => navigate('prompts')}>
            <span className="overview-link__title">Prompts</span>
            <span className="overview-link__detail">
              {promptCount} slash {promptCount === 1 ? 'command' : 'commands'} for MCP clients
            </span>
          </button>
        </li>
        <li>
          <button type="button" className="overview-link" onClick={() => navigate('settings', 'tool-safety-heading')}>
            <span className="overview-link__title">Tool safety</span>
            <span className="overview-link__detail">
              {profile} profile, {enabledCount} of {totalCount} tools enabled
            </span>
          </button>
        </li>
      </ul>
    </Section>
  );
}
