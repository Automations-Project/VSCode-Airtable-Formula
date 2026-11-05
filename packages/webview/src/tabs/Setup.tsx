import React from 'react';
import { ProgressField } from '../components/ProgressField.js';
import { useStore } from '../store.js';
import { EditorsSection } from './setup/EditorsSection.js';
import { LocalServiceSection } from './setup/LocalServiceSection.js';
import { ManualConfigSection } from './setup/ManualConfigSection.js';
import { OfficialAirtableSection } from './setup/OfficialAirtableSection.js';
import { RemoteAccessSection } from './setup/RemoteAccessSection.js';

/** Sign-in needs a browser; while the bundled Chromium downloads, show real progress. */
function BrowserDownloadNotice() {
  const download = useStore(s => s.auth.browserDownload);
  if (download?.status !== 'downloading') return null;

  // Deliberately not <Feedback>: its status live region would announce every percent.
  return (
    <div className="feedback" data-variant="info">
      <ProgressField label="Bundled Chromium download" value={download.progress ?? 0} />
    </div>
  );
}

export function Setup() {
  return (
    <section className="tab-stack" aria-labelledby="setup-heading">
      <h1 id="setup-heading" className="tab-heading" tabIndex={-1}>Setup</h1>
      <BrowserDownloadNotice />
      <LocalServiceSection />
      <EditorsSection />
      <RemoteAccessSection />
      <ManualConfigSection />
      <OfficialAirtableSection />
    </section>
  );
}
