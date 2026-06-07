'use client';

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

interface Props {
  data: Array<{ label: string; value: number }>;
  color?: string;
  height?: number;
}

export function LineChartCard({ data, color = '#00e8c6', height = 200 }: Props) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
        <defs>
          <linearGradient id="acdp-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={color} stopOpacity={0.3} />
            <stop offset="95%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.07)" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#8b90a8' }} tickLine={false} axisLine={false} />
        <YAxis tick={{ fontSize: 10, fill: '#8b90a8' }} tickLine={false} axisLine={false} />
        <Tooltip
          contentStyle={{ background: '#1a1b28', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, fontSize: 11 }}
          labelStyle={{ color: '#8b90a8' }}
          itemStyle={{ color }}
        />
        <Area type="monotone" dataKey="value" stroke={color} strokeWidth={2} fill="url(#acdp-area)" dot={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}
