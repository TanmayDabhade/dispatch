import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';

import {
  clearTeamCredential,
  isTeamLocalPage,
  readTeamCredential,
  saveTeamCredential,
} from '../../lib/teamLocal';
import { SignInView, verifyTeamToken } from '../../views/SignInView';
import { Spinner } from '@/ui/spinner';

interface TeamLocalGateProps {
  children: ReactNode;
}

/**
 * Stands in front of the whole app on a page a team-local daemon served, and
 * is a no-op everywhere else — the desktop app, a solo browser tab, the demo.
 *
 * Split in two so the hooks below only ever run on a team-local page, instead
 * of one component whose hooks sit behind a condition.
 */
export function TeamLocalGate({ children }: TeamLocalGateProps) {
  return isTeamLocalPage() ? (
    <TeamLocalSignIn>{children}</TeamLocalSignIn>
  ) : (
    <>{children}</>
  );
}

type GateState = 'checking' | 'signed-in' | 'signed-out';

function TeamLocalSignIn({ children }: TeamLocalGateProps) {
  const [state, setState] = useState<GateState>(() =>
    readTeamCredential() === null ? 'signed-out' : 'checking'
  );
  const [notice, setNotice] = useState<string | null>(null);

  // A stored credential is re-checked on every load rather than trusted: a
  // token revoked since last time should land its holder on the sign-in
  // screen with a reason, not in an app where every request quietly 401s.
  useEffect(() => {
    if (state !== 'checking') return;
    const stored = readTeamCredential();
    if (stored === null) {
      setState('signed-out');
      return;
    }
    let cancelled = false;
    verifyTeamToken(window.location.origin, stored.token)
      .then((fresh) => {
        if (cancelled) return;
        // Re-saved so a tier changed since sign-in (re-invited with --decide)
        // is what the app sees.
        saveTeamCredential(fresh);
        setState('signed-in');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        clearTeamCredential();
        setNotice(err instanceof Error ? err.message : String(err));
        setState('signed-out');
      });
    return () => {
      cancelled = true;
    };
  }, [state]);

  if (state === 'checking') {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner className="text-muted-foreground size-5" />
      </div>
    );
  }
  if (state === 'signed-out') {
    return (
      <SignInView
        baseUrl={window.location.origin}
        notice={notice}
        onSignedIn={() => window.location.reload()}
      />
    );
  }
  return <>{children}</>;
}
