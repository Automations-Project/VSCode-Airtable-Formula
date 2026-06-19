/**
 * Human-readable and machine-readable rendering of a schema sync plan and diff.
 */

/** Maximum number of drift entries to include in a digest driftSample. */
export const DRIFT_SAMPLE_CAP = 25;

/** Maximum number of changeset entries to include in the plan sample digest. */
export const CHANGESET_SAMPLE_CAP = DRIFT_SAMPLE_CAP; // reuse the same 25 limit

/**
 * Render a plan into a human-readable summary and a machine-readable copy.
 *
 * When actions carry annotated `changeId` fields (added by Task 9), the returned
 * `machine` object gains a `sample` array (capped at CHANGESET_SAMPLE_CAP) where
 * each entry is `{ changeId, op, table, target }` derived by splitting the changeId
 * on `"|"`. The `human` string also includes an `editHint` telling the caller how to
 * selectively skip actions via `apply:false` or the `skip:[changeId]` param.
 *
 * @param {{ actions: object[], orphans: object[], warnings: object[] }} plan
 * @returns {{ human: string, machine: object }}
 */
export function renderPlan(plan) {
  const counts = {};
  for (const a of plan.actions) counts[a.kind] = (counts[a.kind] || 0) + 1;
  const lines = ['Schema plan:'];
  for (const k of ['createTable', 'reconcilePrimary', 'createField', 'updateField', 'createView', 'applyViewConfig']) {
    if (counts[k]) lines.push(`  ${k}: ${counts[k]}`);
  }
  lines.push(`  orphans: ${plan.orphans.length} (reported, not changed)`);
  if (plan.warnings.length) {
    lines.push('  warnings:');
    for (const w of plan.warnings) lines.push(`    - ${w.code}: ${w.message}`);
  }

  // Build changeset sample from annotated actions (Task 10).
  // Only include actions that carry a changeId (added by Task 9's computePlan annotation).
  const sample = [];
  for (const a of plan.actions) {
    if (!a.changeId) continue;
    if (sample.length >= CHANGESET_SAMPLE_CAP) break;
    const [op = '', table = '', target = ''] = a.changeId.split('|');
    sample.push({ changeId: a.changeId, op, table, target });
  }

  // Attach sample to plan in-place so machine === plan still holds.
  plan.sample = sample;

  // editHint: only emit when there are annotated actions.
  const editHint = sample.length > 0
    ? `To skip individual changes, set apply:false on entries or pass skip:[changeId,...] to mode=apply.`
    : null;

  if (editHint) lines.push(editHint);

  return { human: lines.join('\n'), machine: plan };
}

export function renderApplyResult(result) {
  if (result.aborted) {
    const msg = (result.warnings && result.warnings[0] && result.warnings[0].message) || 'aborted';
    return { human: `Apply aborted (${result.reason}): ${msg}`, machine: result };
  }
  const lines = [
    `Apply ${result.planId}:`,
    `  created: ${result.created}`,
    `  updated: ${result.updated}`,
    `  skipped: ${result.skipped}`,
    `  failed: ${result.failed}`,
  ];
  if (result.records) {
    const r = result.records;
    if (r.status === 'running') {
      lines.push(`  records: started in background (jobId=${r.jobId}) — poll with sync_base mode=status, planId="${r.jobId}"`);
    } else {
      lines.push(
        `  records: created ${r.created} / updated ${r.updated} / failed ${r.failed} / attachments ${r.attachmentsUploaded} / viewFilters ${r.viewFiltersReapplied}`
      );
    }
  }
  if (result.warnings && result.warnings.length) {
    lines.push('  warnings:');
    for (const w of result.warnings) lines.push(`    - ${w.code}: ${w.message}`);
  }
  return { human: lines.join('\n'), machine: result };
}

/**
 * Render a diff (from compare()) into human-readable and machine-readable forms.
 *
 * Without `detail`: returns a digest — per-table count rollup and a capped drift sample.
 * With `detail=<tableName>`: returns that table's full entries (sliced by offset/limit).
 *
 * @param {{ diffId:string, sourceBaseId:string, destBaseId:string, identical:boolean, converged:boolean, summary:object, tables:Array, onlyInSourceTables:string[], onlyInDestTables:string[] }} diff
 * @param {{ detail?:string, offset?:number, limit?:number }} [opts]
 * @returns {{ human: string, machine: object }}
 */
export function renderDiff(diff, { detail, offset = 0, limit } = {}) {
  if (detail !== undefined && detail !== null && detail !== '') {
    // Detail mode: return a single table's full entries.
    const tableEntry = diff.tables.find((t) => t.name === detail);
    if (!tableEntry) {
      const available = diff.tables.filter((t) => t.status === 'differs').map((t) => t.name).join(', ');
      return {
        human: `Table "${detail}" not found in diff. Available differing tables: ${available || '(none)'}`,
        machine: { error: `Table "${detail}" not found in diff. Available: ${available || '(none)'}` },
      };
    }

    // Slice entries by offset/limit.
    const sliced = limit !== undefined
      ? tableEntry.entries.slice(offset, offset + limit)
      : tableEntry.entries.slice(offset);

    const lines = [`Diff detail — ${detail} (${sliced.length} of ${tableEntry.entries.length} entries):`];
    for (const e of sliced) {
      lines.push(`  [${e.class}] ${e.scope} / ${e.key}: ${JSON.stringify(e.source)} → ${JSON.stringify(e.dest)}`);
    }
    if (tableEntry.fields.onlyInSource.length) {
      lines.push(`  fields only in source: ${tableEntry.fields.onlyInSource.join(', ')}`);
    }
    if (tableEntry.fields.onlyInDest.length) {
      lines.push(`  fields only in dest: ${tableEntry.fields.onlyInDest.join(', ')}`);
    }
    if (tableEntry.views.onlyInSource.length) {
      lines.push(`  views only in source: ${tableEntry.views.onlyInSource.join(', ')}`);
    }
    if (tableEntry.views.onlyInDest.length) {
      lines.push(`  views only in dest: ${tableEntry.views.onlyInDest.join(', ')}`);
    }

    return {
      human: lines.join('\n'),
      machine: {
        entries: sliced,
        fields: tableEntry.fields,
        views: tableEntry.views,
      },
    };
  }

  // Digest mode: build per-table rollup counts and a capped drift sample.
  const tableSummaries = [];
  const driftSample = [];

  for (const t of diff.tables) {
    let drift = 0;
    let bestEffort = 0;
    let notSynced = 0;
    for (const e of t.entries) {
      if (e.class === 'drift') drift++;
      else if (e.class === 'best-effort') bestEffort++;
      else if (e.class === 'not-synced') notSynced++;
    }

    tableSummaries.push({ table: t.name, status: t.status, drift, bestEffort, notSynced });

    // Collect drift entries for the sample (capped at DRIFT_SAMPLE_CAP across all tables).
    if (driftSample.length < DRIFT_SAMPLE_CAP) {
      for (const e of t.entries) {
        if (e.class === 'drift' && driftSample.length < DRIFT_SAMPLE_CAP) {
          driftSample.push({ table: t.name, scope: e.scope, key: e.key, source: e.source, dest: e.dest });
        }
      }
    }
  }

  const totalDrift = diff.summary.drift;
  const driftMore = totalDrift - driftSample.length;

  // Build detailHint (list differing tables, not "same" ones).
  const differingTables = diff.tables.filter((t) => t.status === 'differs').map((t) => t.name);
  const detailHint = differingTables.length > 0
    ? `Re-call with detail=<tableName> to drill in. Tables with diffs: ${differingTables.join(', ')}`
    : 'No differing tables.';

  // Build human digest.
  const verdictLine = diff.identical
    ? 'Diff: identical (fully converged)'
    : diff.converged
      ? 'Diff: not identical but converged (no sync actions needed)'
      : `Diff: ${totalDrift} drift, ${diff.summary.bestEffort} best-effort, ${diff.summary.notSynced} not-synced`;
  const lines = [verdictLine];
  for (const ts of tableSummaries) {
    lines.push(`  ${ts.table} [${ts.status}]: drift=${ts.drift}, best-effort=${ts.bestEffort}, not-synced=${ts.notSynced}`);
  }
  if (diff.onlyInSourceTables.length) {
    lines.push(`  source-only tables: ${diff.onlyInSourceTables.join(', ')}`);
  }
  if (diff.onlyInDestTables.length) {
    lines.push(`  dest-only tables: ${diff.onlyInDestTables.join(', ')}`);
  }
  if (driftSample.length > 0) {
    lines.push(`Drift sample (first ${driftSample.length} of ${totalDrift}):`);
    for (const s of driftSample) {
      lines.push(`  [${s.table}] ${s.scope} / ${s.key}: ${JSON.stringify(s.source)} → ${JSON.stringify(s.dest)}`);
    }
    if (driftMore > 0) {
      lines.push(`  ... +${driftMore} more drift entries — use detail=<tableName> to inspect.`);
    }
  }
  lines.push(detailHint);

  return {
    human: lines.join('\n'),
    machine: {
      diffId: diff.diffId,
      sourceBaseId: diff.sourceBaseId,
      destBaseId: diff.destBaseId,
      identical: diff.identical,
      converged: diff.converged,
      summary: diff.summary,
      tables: tableSummaries,
      driftSample,
      detailHint,
    },
  };
}
