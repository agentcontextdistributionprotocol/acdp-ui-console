'use client';

import { useMemo } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { shortAuthority } from '@/lib/utils/acdp';
import type { LineageGraph } from '@/lib/types';

interface NodeData extends Record<string, unknown> {
  title: string;
  step: number;
  authority: string;
  contextType: string;
  active: boolean;
}

function LineageNodeCard({ data }: NodeProps) {
  const d = data as NodeData;
  return (
    <div className={`dag-node${d.active ? ' active' : ''}`}>
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <div className="dag-step">
        Step {d.step} · {shortAuthority(d.authority)}
      </div>
      <div className="dag-title">{d.title}</div>
      <div className="dag-chips">
        <span className="chip">{d.contextType}</span>
      </div>
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
    </div>
  );
}

const nodeTypes = { lineage: LineageNodeCard };

/** Lay out nodes by step (rows) and spread same-step nodes across columns. */
function layout(graph: LineageGraph, activeCtx?: string): { nodes: Node[]; edges: Edge[] } {
  const byStep = new Map<number, typeof graph.nodes>();
  for (const n of graph.nodes) {
    const arr = byStep.get(n.step) ?? [];
    arr.push(n);
    byStep.set(n.step, arr);
  }
  const nodes: Node[] = [];
  for (const [step, group] of [...byStep.entries()].sort((a, b) => a[0] - b[0])) {
    group.forEach((n, i) => {
      nodes.push({
        id: n.ctx_id,
        type: 'lineage',
        position: { x: i * 210 + 20, y: (step - 1) * 150 + 20 },
        data: {
          title: n.title,
          step: n.step,
          authority: n.registry_authority,
          contextType: n.context_type,
          active: n.ctx_id === activeCtx,
        } satisfies NodeData,
      });
    });
  }
  const edges: Edge[] = graph.edges.map((e, i) => ({
    id: `e-${i}`,
    source: e.src,
    target: e.dst,
    animated: true,
    style: { stroke: 'rgba(0,232,198,0.4)', strokeDasharray: '4 3' },
  }));
  return { nodes, edges };
}

export function LineageDag({
  graph,
  activeCtx,
  onSelectCtx,
  height,
}: {
  graph: LineageGraph;
  activeCtx?: string;
  onSelectCtx?: (ctxId: string) => void;
  height?: number | string;
}) {
  const { nodes, edges } = useMemo(() => layout(graph, activeCtx), [graph, activeCtx]);

  if (graph.nodes.length === 0) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--faint)', fontSize: 12 }}>
        No lineage yet
      </div>
    );
  }

  return (
    <div style={{ flex: 1, height: height ?? '100%', minHeight: 240, background: 'var(--panel-2)' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        proOptions={{ hideAttribution: true }}
        onNodeClick={(_, node) => onSelectCtx?.(node.id)}
        nodesDraggable={false}
        nodesConnectable={false}
      >
        <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="rgba(255,255,255,0.05)" />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
