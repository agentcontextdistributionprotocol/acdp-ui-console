'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { startRun } from '@/lib/api/client';
import { usePreferencesStore } from '@/lib/stores/preferences-store';
import { ErrorDetail } from '@/components/ui/error-panel';
import { errorDiagnostic, operatorErrorMessage } from '@/lib/utils/api-error-messages';
import { C } from '@/lib/colors';
import type { RegistryMode, ScenarioDef } from '@/lib/types';

const MODES: RegistryMode[] = ['single', 'dual', 'cross_org'];

export function LaunchModal({ scenario, onClose }: { scenario: ScenarioDef | null; onClose: () => void }) {
  const router = useRouter();
  const demoMode = usePreferencesStore((s) => s.demoMode);
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [mode, setMode] = useState<RegistryMode>('single');
  const [submitting, setSubmitting] = useState(false);
  /**
   * The THROWN VALUE, not a message derived from it.
   *
   * `setError(String(e))` discarded the `ApiError` at the catch, so by render
   * time there was nothing left to ask about status, service or provenance —
   * every failure arrived as `ApiError: <the upstream's raw body>` and a
   * network `TypeError` arrived as `TypeError: Failed to fetch`. Keeping the
   * value means the message is derived where the copy lives.
   *
   * Wrapped in an object rather than stored bare. `useState`'s setter treats a
   * FUNCTION argument as a functional update, so `setError(e)` would silently
   * invoke the caught value if it were ever callable — and `setError(() => e)`
   * is the same trap facing the other way (it stores nothing and schedules the
   * error as an updater). A wrapper makes the ambiguity unrepresentable.
   */
  const [caught, setCaught] = useState<{ err: unknown } | null>(null);

  const [prevScenarioId, setPrevScenarioId] = useState(scenario?.id ?? null);
  if (prevScenarioId !== (scenario?.id ?? null)) {
    setPrevScenarioId(scenario?.id ?? null);
    if (scenario) {
      const init: Record<string, string> = {};
      for (const [k, v] of Object.entries(scenario.default_inputs)) init[k] = String(v ?? '');
      setInputs(init);
      setMode(scenario.registry_mode);
      setCaught(null);
    }
  }

  if (!scenario) return null;

  const submit = async () => {
    setSubmitting(true);
    // Cleared BEFORE the request, not on success: without this a second attempt
    // renders the previous failure under a launch that is in flight, and a
    // success that navigates away leaves it on screen for the frame before the
    // route changes.
    setCaught(null);
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
      setCaught({ err: e });
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

      {/* The modal STAYS OPEN on failure — `onClose()` runs only after a
          successful `startRun` — because the operator needs the message beside
          the form they submitted.

          No `codes` map, and none is possible: this is the only playground
          mutation, and FastAPI's `HTTPException(404, "unknown scenario: …")`
          (`acdp-playground/playground/api/runs.py:30`) serialises as
          `{"detail": …}`, which `parseErrorCode` (`fetcher.ts:10-20`) does not
          read — it looks for `errorCode` and `error.code`. Every arm this
          surface can reach is a status arm, so the lead carries all of the
          specificity, and a 404 gets the one thing the status alone cannot
          say: it is a deployment mismatch, not a transient.

          Both halves are derived at render from the stored value — the message
          and the diagnostic. The disclosure is bounded by `.error-detail > pre`
          (`max-height` + `overflow: auto`), so opening it inside a modal
          scrolls rather than pushing the footer buttons out of reach, and it
          renders nothing at all for a non-`ApiError` throw, where there are no
          upstream bytes to disclose. */}
      {caught && (
        <div style={{ marginTop: 14, fontSize: 11, color: C.danger, background: 'rgba(240,93,122,0.08)', padding: 10, borderRadius: 8 }}>
          {operatorErrorMessage(caught.err, 'Could not start this scenario', {
            notFound: 'no scenario with that id exists on this playground.',
          })}
          <ErrorDetail details={errorDiagnostic(caught.err)} />
        </div>
      )}
    </Modal>
  );
}
