'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { startRun } from '@/lib/api/client';
import { usePreferencesStore } from '@/lib/stores/preferences-store';
import { C } from '@/lib/colors';
import type { RegistryMode, ScenarioDef } from '@/lib/types';

const MODES: RegistryMode[] = ['single', 'dual', 'cross_org'];

export function LaunchModal({ scenario, onClose }: { scenario: ScenarioDef | null; onClose: () => void }) {
  const router = useRouter();
  const demoMode = usePreferencesStore((s) => s.demoMode);
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [mode, setMode] = useState<RegistryMode>('single');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!scenario) return;
    const init: Record<string, string> = {};
    for (const [k, v] of Object.entries(scenario.default_inputs)) init[k] = String(v ?? '');
    setInputs(init);
    setMode(scenario.registry_mode);
    setError(null);
  }, [scenario]);

  if (!scenario) return null;

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const parsed: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(inputs)) {
        const orig = scenario.default_inputs[k];
        parsed[k] = typeof orig === 'number' ? Number(v) : v;
      }
      const res = await startRun(scenario.id, parsed, mode, demoMode);
      onClose();
      router.push(`/runs/${res.run_id}`);
    } catch (e) {
      setError(String(e));
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={!!scenario}
      onClose={onClose}
      title={`Launch · ${scenario.name}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={submitting}>
            {submitting ? 'Launching…' : '▶ Run scenario'}
          </Button>
        </>
      }
    >
      <p style={{ fontSize: 12, color: C.muted, marginBottom: 16 }}>{scenario.description}</p>

      <div className="config-form">
        {Object.keys(inputs).length === 0 && (
          <div style={{ fontSize: 12, color: C.faint }}>This scenario takes no inputs.</div>
        )}
        {Object.entries(inputs).map(([key, value]) => (
          <div key={key} className="form-row">
            <span className="form-label">{key}</span>
            <input
              className="form-input"
              value={value}
              onChange={(e) => setInputs((prev) => ({ ...prev, [key]: e.target.value }))}
            />
          </div>
        ))}
        <div className="form-row">
          <span className="form-label">registry_mode</span>
          <select className="form-input" value={mode} onChange={(e) => setMode(e.target.value as RegistryMode)}>
            {MODES.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <div style={{ marginTop: 14, fontSize: 11, color: C.danger, background: 'rgba(240,93,122,0.08)', padding: 10, borderRadius: 8 }}>
          {error}
        </div>
      )}
    </Modal>
  );
}
