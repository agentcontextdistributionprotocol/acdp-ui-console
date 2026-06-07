'use client';

import type { ScenarioDef } from '@/lib/types';

const MODE_LABEL: Record<string, string> = {
  single: 'single registry',
  dual: 'dual registry',
  cross_org: 'cross-org',
};

const MODE_CHIP: Record<string, string> = {
  single: 'chip',
  dual: 'chip mode-dual',
  cross_org: 'chip mode-cross',
};

export function scenarioNumber(id: string): string {
  const m = id.match(/^s(\d+)_/i);
  return m ? `S${m[1]}` : id.slice(0, 3).toUpperCase();
}

/** Categorize a scenario into a chip emphasising what it exercises. */
function tagChips(s: ScenarioDef): { label: string; cls: string }[] {
  const chips: { label: string; cls: string }[] = [
    { label: MODE_LABEL[s.registry_mode] ?? s.registry_mode, cls: MODE_CHIP[s.registry_mode] ?? 'chip' },
    { label: `${s.agent_count} agent${s.agent_count === 1 ? '' : 's'}`, cls: 'chip' },
  ];
  const id = s.id.toLowerCase();
  if (id.includes('tenant') || id.includes('revoc') || id.includes('rotation') || id.includes('p256') || id.includes('did_web'))
    chips.push({ label: 'auth', cls: 'chip ok' });
  else if (id.includes('ssrf') || id.includes('restricted') || id.includes('policy') || id.includes('authz'))
    chips.push({ label: 'security', cls: 'chip ok' });
  else if (id.includes('supersession') || id.includes('idempotency') || id.includes('domain'))
    chips.push({ label: 'protocol', cls: 'chip ok' });
  else chips.push({ label: s.framework, cls: 'chip' });
  return chips;
}

export function ScenarioCard({ scenario, onLaunch }: { scenario: ScenarioDef; onLaunch: (s: ScenarioDef) => void }) {
  return (
    <div className="scenario-card" onClick={() => onLaunch(scenario)}>
      <div className="sc-header">
        <span className="sc-num">{scenarioNumber(scenario.id)}</span>
        <div className="sc-name">{scenario.name}</div>
      </div>
      <div className="sc-desc">{scenario.description}</div>
      <div className="sc-chips">
        {tagChips(scenario).map((c, i) => (
          <span key={i} className={c.cls}>
            {c.label}
          </span>
        ))}
      </div>
      <button
        className="sc-run-btn"
        onClick={(e) => {
          e.stopPropagation();
          onLaunch(scenario);
        }}
      >
        ▶ Run
      </button>
    </div>
  );
}
