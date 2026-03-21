import React from 'react';

interface StatCardProps { value: string | number; label: string; accent?: 'blue' | 'green' | 'yellow'; }
const accents = { blue: 'var(--at-blueLight1)', green: 'var(--at-greenLight1)', yellow: 'var(--at-yellowLight1)' };

export function StatCard({ value, label, accent }: StatCardProps) {
  return (
    <div className="metric-card">
      <div className="metric-value" style={{ color: accent ? accents[accent] : 'var(--fg)' }}>{value}</div>
      <div className="metric-label">{label}</div>
    </div>
  );
}
