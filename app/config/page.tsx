'use client';

import { Settings } from 'lucide-react';
import { SectionTitle } from '@/components/ui/section-title';
import { ConnectionPanel } from '@/components/config/connection-panel';
import { WebhookConfig } from '@/components/config/webhook-config';
import { SdkMatrix } from '@/components/config/sdk-matrix';

export default function ConfigPage() {
  return (
    <div className="page">
      <SectionTitle icon={Settings} title="Config" />
      <div className="grid-2" style={{ marginBottom: 12, alignItems: 'start' }}>
        <ConnectionPanel />
        <SdkMatrix />
      </div>
      <WebhookConfig />
    </div>
  );
}
