import React from 'react';

interface StatCardProps { value: string | number; label: string; accent?: 'blue' | 'green' | 'yellow'; }
const accents = { blue: 'var(--at-blueLight1)', green: 'var(--at-greenLight1)', yellow: 'var(--at-yellowLight1)' };

export function StatCard({ value, label, accent }: StatCardProps) {
  return (
    <div style={{ background: 'var(--bg-inset)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '10px 12px' }}>
      <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: -0.5, lineHeight: 1, color: accent ? accents[accent] : 'var(--fg)' }}>{value}</div>
      <div style={{ fontSize: 9, color: 'var(--fg-muted)', fontWeight: 500, marginTop: 3 }}>{label}</div>
    </div>
  );
}
