'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutGrid,
  FlaskConical,
  Play,
  ListTree,
  Boxes,
  Users,
  Database,
  Activity,
  Settings,
  GitBranch,
  ShieldCheck,
  BadgeCheck,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { usePreferencesStore } from '@/lib/stores/preferences-store';
import { useMounted } from '@/lib/hooks/use-mounted';

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  badge?: string;
}

interface NavGroup {
  section: string;
  items: NavItem[];
}

const NAV: NavGroup[] = [
  {
    section: 'Overview',
    items: [{ href: '/dashboard', label: 'Dashboard', icon: LayoutGrid }],
  },
  {
    section: 'Playground',
    items: [
      { href: '/scenarios', label: 'Scenarios', icon: FlaskConical, badge: '25' },
      { href: '/runs', label: 'Runs', icon: Play },
    ],
  },
  {
    section: 'Control Plane',
    items: [
      { href: '/events', label: 'Events', icon: ListTree },
      { href: '/contexts', label: 'Contexts', icon: Boxes },
      { href: '/lineage', label: 'Lineage', icon: GitBranch },
      { href: '/agents', label: 'Agents', icon: Users },
      { href: '/registries', label: 'Registries', icon: Database },
      { href: '/trust', label: 'Trust', icon: BadgeCheck },
      { href: '/security', label: 'Security', icon: ShieldCheck },
    ],
  },
  {
    section: 'Operations',
    items: [
      { href: '/observability', label: 'Observability', icon: Activity },
      { href: '/config', label: 'Config', icon: Settings },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const mounted = useMounted();
  // Default to demo mode until the persisted store has rehydrated, so SSR and
  // the first client paint agree.
  const demoMode = usePreferencesStore((s) => s.demoMode);
  const showDemo = !mounted || demoMode;

  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <div className="logo-mark">
          <svg viewBox="0 0 16 16" fill="none" stroke="#00e8c6" strokeWidth="1.5" strokeLinecap="round">
            <circle cx="8" cy="8" r="6" />
            <path d="M4 8h8M8 4v8" />
          </svg>
        </div>
        <div className="logo-text">
          <div className="name">ACDP</div>
          <div className="sub">Console</div>
        </div>
      </div>

      <nav className="nav">
        {NAV.map((group) => (
          <div key={group.section}>
            <div className="nav-section">{group.section}</div>
            {group.items.map((item) => {
              const active =
                pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href));
              const Icon = item.icon;
              return (
                <Link key={item.href} href={item.href} className={`nav-item${active ? ' active' : ''}`}>
                  <Icon />
                  {item.label}
                  {item.badge && <span className="nav-badge">{item.badge}</span>}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="sidebar-footer">
        <div className="conn-pill">
          <div className={`dot ${showDemo ? 'warn' : 'ok'} pulse`} />
          <span>{showDemo ? 'Demo mode' : 'Live backend'}</span>
        </div>
      </div>
    </aside>
  );
}
