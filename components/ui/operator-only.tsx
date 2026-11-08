import Link from 'next/link';
import { Lock } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { LOGIN_ROUTE } from '@/lib/routes';

/**
 * Stands in for an operator-only section when a public-mode visitor is not
 * signed in. The console refuses every admin route to that visitor (403
 * `CONSOLE_OPERATOR_SESSION_REQUIRED`), so the section neither fetches nor
 * offers its controls; it says what it is and where to sign in.
 */
export function OperatorOnly({ title, description }: { title: string; description: string }) {
  return (
    <EmptyState
      icon={Lock}
      title={title}
      description={description}
      action={
        <Link href={LOGIN_ROUTE} className="btn btn-secondary">
          Sign in
        </Link>
      }
    />
  );
}
