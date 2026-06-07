export function StatusDot({ tone = 'ok', pulse = false }: { tone?: 'ok' | 'warn' | 'err'; pulse?: boolean }) {
  return <span className={`dot ${tone}${pulse ? ' pulse' : ''}`} />;
}
