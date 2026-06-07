'use client';

import { Card, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { MOCK_SDK_MATRIX } from '@/lib/data/mock-data';

export function SdkMatrix() {
  return (
    <Card>
      <CardHeader title="SDK Matrix" />
      <table className="data-table">
        <thead>
          <tr>
            <th>Component</th>
            <th>Version</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {MOCK_SDK_MATRIX.map((row) => (
            <tr key={row.component}>
              <td>{row.component}</td>
              <td className="did">{row.version}</td>
              <td>
                <Badge variant="complete">● {row.status}</Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
