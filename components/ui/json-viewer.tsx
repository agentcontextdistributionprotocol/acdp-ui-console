'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function Leaf({ value }: { value: unknown }) {
  if (value === null) return <span className="j-null">null</span>;
  if (typeof value === 'string') return <span className="j-str">&quot;{value}&quot;</span>;
  if (typeof value === 'number') return <span className="j-num">{value}</span>;
  if (typeof value === 'boolean') return <span className="j-bool">{String(value)}</span>;
  return <span className="j-null">{String(value)}</span>;
}

function Node({ name, value, level }: { name?: string; value: unknown; level: number }) {
  const [open, setOpen] = useState(level < 2);
  const indent = { paddingLeft: level === 0 ? 0 : 12 };

  if (Array.isArray(value) || isObject(value)) {
    const entries = Array.isArray(value)
      ? value.map((v, i) => [String(i), v] as const)
      : Object.entries(value);
    const isArr = Array.isArray(value);
    return (
      <div style={indent}>
        <span className="j-toggle" onClick={() => setOpen((o) => !o)}>
          {open ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
          {name !== undefined && (
            <>
              <span className="j-key">&quot;{name}&quot;</span>
              <span className="j-punc">: </span>
            </>
          )}
          <span className="j-punc">
            {isArr ? '[' : '{'}
            {!open && <span style={{ opacity: 0.6 }}>{entries.length}</span>}
            {!open && (isArr ? ']' : '}')}
          </span>
        </span>
        {open && (
          <div style={{ borderLeft: '1px dashed var(--border)', marginLeft: 4, paddingLeft: 6 }}>
            {entries.map(([k, v]) => (
              <Node key={k} name={isArr ? undefined : k} value={v} level={level + 1} />
            ))}
          </div>
        )}
        {open && <span className="j-punc">{isArr ? ']' : '}'}</span>}
      </div>
    );
  }

  return (
    <div style={indent}>
      {name !== undefined && (
        <>
          <span className="j-key">&quot;{name}&quot;</span>
          <span className="j-punc">: </span>
        </>
      )}
      <Leaf value={value} />
    </div>
  );
}

export function JsonViewer({ data, style }: { data: unknown; style?: React.CSSProperties }) {
  return (
    <div className="json-viewer" style={style}>
      <Node value={data} level={0} />
    </div>
  );
}
