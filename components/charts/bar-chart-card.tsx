'use client';

import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

interface Props {
  data: Array<{ label: string; value: number }>;
  color?: string;
  height?: number;
}

export function BarChartCard({ data, color = '#00e8c6', height = 200 }: Props) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ left: 4, right: 14, top: 4, bottom: 4 }}>
        <XAxis type="number" tick={{ fontSize: 9, fill: '#8b90a8' }} tickLine={false} axisLine={false} />
        <YAxis
          type="category"
          dataKey="label"
          tick={{ fontSize: 10, fill: '#8b90a8' }}
          tickLine={false}
          axisLine={false}
          width={130}
        />
        <Tooltip
          cursor={{ fill: 'rgba(255,255,255,0.04)' }}
          contentStyle={{ background: '#1a1b28', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, fontSize: 11 }}
          labelStyle={{ color: '#8b90a8' }}
          itemStyle={{ color }}
        />
        <Bar dataKey="value" fill={color} radius={[0, 4, 4, 0]} barSize={14} />
      </BarChart>
    </ResponsiveContainer>
  );
}
