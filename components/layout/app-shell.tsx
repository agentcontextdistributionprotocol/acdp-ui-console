'use client';

import { Sidebar } from './sidebar';
import { Topbar } from './topbar';

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="shell">
      <Sidebar />
      <Topbar />
      <main className="content">{children}</main>
    </div>
  );
}
