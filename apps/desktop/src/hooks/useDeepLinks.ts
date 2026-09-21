import { useEffect, useRef } from 'react';

import { formatTaskLink } from '../lib/deepLink';
import { isTauri } from '../lib/tauri';

/**
 * Delivers every deep link the window receives to `onLink`, always in the
 * `dispatch://` form so the router (`useDeepLinkRouter`) parses one shape.
 * In the Tauri webview that is the deep-link plugin: `getCurrent()` once for
 * a cold start (`open 'dispatch://…'` delivers the URL before the webview has
 * subscribed) then `onOpenUrl` for links opened while the app runs. In the
 * browser-dev harness there is no plugin, so a `?task=<id>` on the harness URL
 * (beside its `root`) is read once on mount instead — the form
 * `formatTaskLink(…, 'browser')` writes. `onLink` lives in a ref so the
 * subscription happens exactly once per mount.
 */
export function useDeepLinks(onLink: (url: string) => void): void {
  const onLinkRef = useRef(onLink);
  onLinkRef.current = onLink;

  useEffect(() => {
    if (!isTauri()) {
      const params = new URLSearchParams(window.location.search);
      const task = params.get('task');
      const root = params.get('root');
      if (task !== null && root !== null) {
        onLinkRef.current(
          formatTaskLink({ taskId: task, project: root }, 'app')
        );
      }
      return;
    }

    const deliver = (urls: string[] | null) =>
      urls?.forEach((url) => onLinkRef.current(url));
    // Loaded lazily so the plugin's `invoke` never runs outside the webview. A
    // failed plugin call is logged, not thrown: a link that does not arrive is
    // not worth an error boundary.
    const plugin = import('@tauri-apps/plugin-deep-link');
    void plugin
      .then(({ getCurrent }) => getCurrent())
      .then(deliver)
      .catch((err: unknown) =>
        console.error('deep-link: getCurrent failed', err)
      );
    const unlisten = plugin.then(({ onOpenUrl }) => onOpenUrl(deliver));
    unlisten.catch((err: unknown) =>
      console.error('deep-link: onOpenUrl failed', err)
    );

    return () => {
      // The rejection above is already logged; nothing to unlisten then.
      void unlisten.then(
        (fn) => fn(),
        () => {}
      );
    };
  }, []);
}
