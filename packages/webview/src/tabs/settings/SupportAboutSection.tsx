import React from 'react';
import { ActionButton } from '../../components/ActionButton.js';
import { OutcomeFeedback } from '../../components/SettingRow.js';
import { Section } from '../../components/Section.js';
import { useActionOutcome } from '../../lib/useActionOutcome.js';
import { useStore } from '../../store.js';

const SUPPORT_LINKS = [
  { id: 'docs' as const, label: 'Open documentation' },
  { id: 'changelog' as const, label: 'Open changelog' },
  { id: 'github' as const, label: 'Open GitHub repository' },
  { id: 'chrome' as const, label: 'Open Chrome website' },
];

export function SupportAboutSection() {
  const versions = useStore(state => state.versions);
  const openLink = useStore(state => state.openLink);
  const [actionId, setActionId] = React.useState<string | null>(null);
  const { outcome, clearOutcome } = useActionOutcome(actionId);

  return (
    <Section
      id="support-about"
      title="Support and About"
      description="Product information and trusted external resources."
    >
      <dl className="about-versions">
        <div className="about-version">
          <dt>Extension</dt>
          <dd>{versions.extension}</dd>
        </div>
        <div className="about-version">
          <dt>Bundled MCP server</dt>
          <dd>{versions.mcpServerBundled}</dd>
        </div>
        {versions.mcpServerPublished && versions.mcpServerPublished !== versions.mcpServerBundled && (
          <div className="about-version">
            <dt>MCP server update</dt>
            <dd>Update available: {versions.mcpServerPublished}</dd>
          </div>
        )}
      </dl>
      <div className="support-actions">
        {SUPPORT_LINKS.map(link => (
          <ActionButton
            key={link.id}
            onClick={() => {
              clearOutcome();
              setActionId(openLink(link.id));
            }}
          >
            {link.label}
          </ActionButton>
        ))}
      </div>
      <OutcomeFeedback outcome={outcome} successMessage="Opened." failureMessage="The link could not be opened." />
    </Section>
  );
}
