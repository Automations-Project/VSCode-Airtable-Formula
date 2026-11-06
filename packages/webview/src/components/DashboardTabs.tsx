import React, { useRef } from 'react';
import type { DashboardTabId } from '@shared/types.js';

interface DashboardTabsProps {
  tabs: readonly { id: DashboardTabId; label: string }[];
  activeTab: DashboardTabId;
  onRequestSelect: (id: DashboardTabId) => boolean | Promise<boolean>;
}

export function DashboardTabs({
  tabs,
  activeTab,
  onRequestSelect,
}: DashboardTabsProps) {
  const refs = useRef(new Map<DashboardTabId, HTMLButtonElement>());
  const activeTabRef = useRef(activeTab);
  const requestSequence = useRef(0);
  activeTabRef.current = activeTab;

  async function requestActivate(index: number): Promise<void> {
    const request = ++requestSequence.current;
    const normalized = (index + tabs.length) % tabs.length;
    const next = tabs[normalized];
    let accepted = false;
    try {
      accepted = await onRequestSelect(next.id);
    } catch {
      accepted = false;
    }
    if (request !== requestSequence.current) return;
    refs.current.get(accepted ? next.id : activeTabRef.current)?.focus();
  }

  function onKeyDown(
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number,
  ): void {
    // Alt+Arrow is browser/history navigation and Ctrl/Cmd/Shift chords belong to
    // the editor or assistive tech: only the bare key moves between tabs.
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      void requestActivate(index + 1);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      void requestActivate(index - 1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      void requestActivate(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      void requestActivate(tabs.length - 1);
    }
  }

  return (
    <div className="app-tabs" role="tablist" aria-label="Dashboard sections">
      {tabs.map((tab, index) => (
        <button
          key={tab.id}
          ref={node => {
            if (node) refs.current.set(tab.id, node);
            else refs.current.delete(tab.id);
          }}
          id={`dashboard-tab-${tab.id}`}
          type="button"
          role="tab"
          aria-selected={activeTab === tab.id}
          aria-controls={`dashboard-panel-${tab.id}`}
          tabIndex={activeTab === tab.id ? 0 : -1}
          className="app-tab"
          onClick={() => {
            void requestActivate(index);
          }}
          onKeyDown={event => onKeyDown(event, index)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
