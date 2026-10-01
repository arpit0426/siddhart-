import React, { useEffect } from 'react';
import { ShieldAlert } from 'lucide-react';
import { navigate, useRoutePath } from '../lib/router';
import { roleHome, useAuth } from '../context/AuthContext';
import { Button, Card, Spinner } from './ui';
import type { Role } from '../types';

/**
 * Client-side route guard - convenience only.
 *
 * The real authorization boundary is the API: every protected endpoint checks the
 * session cookie and the account's role server-side. This guard just avoids
 * showing a workspace the current session cannot use.
 */
export const RequireRole: React.FC<{ role: Role; children: React.ReactNode }> = ({ role, children }) => {
  const { user, loading, login } = useAuth();
  const path = useRoutePath();
  const [switching, setSwitching] = React.useState(false);

  useEffect(() => {
    if (loading || user) return;
    navigate(`/${role}/auth?next=${encodeURIComponent(path)}`, { replace: true });
  }, [loading, user, role, path]);

  if (loading) return <Spinner label="Checking your session…" />;

  if (!user) return <Spinner label="Redirecting to sign in…" />;

  if (user.role !== role) {
    const handleSwitchDemo = async () => {
      setSwitching(true);
      try {
        const creds = {
          customer: { email: 'customer.demo@nearbuy.app', password: 'NearBuy@2026' },
          seller: { email: 'seller.demo@nearbuy.app', password: 'NearBuy@2026' },
          rider: { email: 'rider.demo@nearbuy.app', password: 'NearBuy@2026' },
        }[role];
        const signedIn = await login({ email: creds.email, password: creds.password, role });
        navigate(roleHome(signedIn.role), { replace: true });
      } catch {
        navigate(`/${role}/auth`, { replace: true });
      } finally {
        setSwitching(false);
      }
    };

    return (
      <div className="mx-auto max-w-lg">
        <Card className="p-6 text-center">
          <ShieldAlert className="mx-auto h-8 w-8 text-amber-600" aria-hidden="true" />
          <h1 className="mt-3 text-base font-bold text-slate-900">This workspace is for {role} accounts</h1>
          <p className="mt-1 text-xs text-slate-600">
            You are currently signed in as {user.name} ({user.role}). You can switch to the demo {role} account or return to your current workspace.
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Button variant="primary" loading={switching} onClick={handleSwitchDemo}>
              Switch to demo {role}
            </Button>
            <Button variant="secondary" onClick={() => navigate(roleHome(user.role))}>
              Go to my workspace
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return <>{children}</>;
};
