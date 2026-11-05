import React from 'react';
import type { DashboardTabId } from '@shared/types.js';
import type { ReadinessIssue, ReadinessModel } from '../selectors/readiness.js';
import { useStore } from '../store.js';
import { ActionButton } from './ActionButton.js';
import type { NavigateFn } from './NextAction.js';
import { Section } from './Section.js';

const TAB_LABELS: Record<DashboardTabId, string> = {
  overview: 'Overview',
  setup: 'Setup',
  prompts: 'Prompts',
  settings: 'Settings',
};

const SEVERITY_LABELS: Record<ReadinessIssue['severity'], string> = {
  error: 'Needs action',
  warning: 'Warning',
  info: 'Note',
};

function formatChecked(value: string): React.ReactNode {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return (
    <time dateTime={date.toISOString()}>
      {date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
    </time>
  );
}

interface StatusSummaryProps {
  readiness: ReadinessModel;
  navigate: NavigateFn;
}

export function StatusSummary({ readiness, navigate }: StatusSummaryProps) {
  const userId = useStore(s => s.auth.userId);
  const lastChecked = useStore(s => s.auth.lastChecked);
  const browser = useStore(s => s.auth.browser);
  const refresh = useStore(s => s.refresh);
  const { terms, issues } = readiness;
  const browserLabel = browser?.found ? browser.label : undefined;

  return (
    <Section
      id="overview-status"
      title="Status"
      actions={<ActionButton onClick={refresh}>Refresh status</ActionButton>}
    >
      {issues.length > 0 && (
        <ul className="issue-list">
          {issues.map(issue => (
            <li key={issue.id} className="issue" data-severity={issue.severity}>
              <div className="issue__copy">
                <span className="issue__severity">{SEVERITY_LABELS[issue.severity]}</span>
                <span className="issue__title">{issue.title}</span>
                <span className="issue__detail">{issue.detail}</span>
              </div>
              <ActionButton
                aria-label={`Open ${TAB_LABELS[issue.tab]}: ${issue.title}`}
                onClick={() => navigate(issue.tab, issue.focusTargetId)}
              >
                Open {TAB_LABELS[issue.tab]}
              </ActionButton>
            </li>
          ))}
        </ul>
      )}
      <dl className="status-facts">
        <div className="status-fact">
          <dt>Session</dt>
          <dd>{terms.session.longLabel}</dd>
        </div>
        {userId && (
          <div className="status-fact">
            <dt>Account</dt>
            <dd className="status-fact__mono">{userId}</dd>
          </div>
        )}
        {browserLabel && (
          <div className="status-fact">
            <dt>Browser</dt>
            <dd>{browserLabel}</dd>
          </div>
        )}
        <div className="status-fact">
          <dt>Service</dt>
          <dd>{terms.service.longLabel}</dd>
        </div>
        {lastChecked && (
          <div className="status-fact">
            <dt>Last checked</dt>
            <dd>{formatChecked(lastChecked)}</dd>
          </div>
        )}
      </dl>
    </Section>
  );
}
