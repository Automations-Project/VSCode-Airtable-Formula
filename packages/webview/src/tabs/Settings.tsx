import React from 'react';
import { useStore } from '../store.js';
import { sendToExtension } from '../lib/vscode.js';

function SettingToggle({ label, desc, value, settingKey }: { label:string; desc?:string; value:boolean; settingKey:string }) {
  const toggle = () => sendToExtension({ type:'setting:change', key: settingKey, value: !value });
  return (
    <div onClick={toggle} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, padding:'10px 14px', borderBottom:'1px solid var(--border)', cursor:'pointer', transition:`background var(--ease-std) 120ms` }}>
      <div>
        <div style={{ fontSize:12 }}>{label}</div>
        {desc && <div style={{ fontSize:9, color:'var(--fg-muted)', marginTop:1 }}>{desc}</div>}
      </div>
      <div style={{ width:32, height:18, borderRadius:9, background: value ? 'var(--at-blue)' : 'var(--at-gray700)', position:'relative', flexShrink:0 }}>
        <div style={{ width:12, height:12, borderRadius:'50%', background:'#fff', position:'absolute', top:3, [value?'right':'left']:3, transition:`all var(--ease-std) 150ms`, boxShadow:'0 1px 3px rgba(0,0,0,0.3)' }} />
      </div>
    </div>
  );
}

export function Settings() {
  const settings = useStore(s => s.settings);

  const group = (title: string, children: React.ReactNode) => (
    <div>
      <div style={{ fontSize:9, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.09em', color:'var(--fg-muted)', marginBottom:6 }}>{title}</div>
      <div style={{ background:'var(--bg-inset)', border:'1px solid var(--border)', borderRadius:'var(--radius-md)', overflow:'hidden' }}>{children}</div>
    </div>
  );

  const handleVersionChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    sendToExtension({ type: 'setting:change', key: 'formula.formatterVersion', value: e.target.value });
  };

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
      {group('MCP Server', <>
        <SettingToggle label="Auto-configure on install" desc="Set up MCP in detected IDEs on first launch" value={settings.mcp.autoConfigureOnInstall} settingKey="mcp.autoConfigureOnInstall" />
        <SettingToggle label="Notify on MCP updates" value={settings.mcp.notifyOnUpdates} settingKey="mcp.notifyOnUpdates" />
      </>)}
      {group('AI Files', <>
        <SettingToggle label="Auto-install AI files" desc="Install skills, rules, workflows on first launch" value={settings.ai.autoInstallFiles} settingKey="ai.autoInstallFiles" />
        <SettingToggle label="Include agent files" desc="Install agent configs where supported" value={settings.ai.includeAgents} settingKey="ai.includeAgents" />
      </>)}
      {group('Formula Engine', <>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'10px 14px' }}>
          <span style={{ fontSize:12 }}>Formatter version</span>
          <select
            value={settings.formula.formatterVersion}
            onChange={handleVersionChange}
            style={{ fontSize:11, fontFamily:'var(--font-mono)', background:'var(--bg-subtle)', border:'1px solid var(--border)', borderRadius:'var(--radius-sm)', padding:'3px 8px', color:'var(--fg-subtle)' }}
          >
            <option value="v2">v2 (default)</option>
            <option value="v1">v1 (legacy)</option>
          </select>
        </div>
      </>)}
    </div>
  );
}
