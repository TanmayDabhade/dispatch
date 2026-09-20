import { CheckIcon, InfoIcon } from 'lucide-react';
import { createContext, useContext, useMemo } from 'react';
import { toast } from 'sonner';

import {
  sonnerActionsFor,
  sonnerOptionsFor,
  type ToastLink,
  type ToastTone,
} from './toastContract';
import { Toaster } from '@/ui/sonner';

interface ToastInput {
  /** 13px/500, beside the tone's 14px icon (a green check for success, an info glyph for
   * an error). */
  title: string;
  /** The 12px muted line under it. For a failure this should be what actually went wrong;
   * for a task, `t-8f2a — Cache the search index` (`taskToastDescription`). */
  description?: string;
  tone?: ToastTone;
  /** The indigo text link under the description — `View task` (`viewTaskLink`). */
  link?: ToastLink;
  /** The same slot as `link`, for follow-ups that are not a navigation (`Restart`). */
  action?: ToastLink;
  /** A second, quieter follow-up rendered as a ghost — dismisses the toast either way. */
  secondary?: ToastLink;
}

interface ToastApi {
  push: (input: ToastInput) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const TONE_FN = {
  error: toast.error,
  success: toast.success,
  info: toast.info,
} as const;

// §12: success is a plain green check, an error is an info glyph with its description.
// The Toaster colours them per tone; the shapes are set here.
const TONE_ICON = {
  error: <InfoIcon aria-hidden />,
  success: <CheckIcon aria-hidden />,
  info: <InfoIcon aria-hidden />,
} as const;

/** Mounts the Linear-styled `Toaster` (a 300px quaternary card, bottom-right) and hands
 * every surface a `push`. There is no close button: a toast times out, or its link or
 * ghost dismisses it. */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const api = useMemo<ToastApi>(
    () => ({
      push: (input) => {
        const tone = input.tone ?? 'info';
        TONE_FN[tone](input.title, {
          description: input.description,
          icon: TONE_ICON[tone],
          ...sonnerActionsFor(input),
          ...sonnerOptionsFor(tone),
        });
      },
    }),
    []
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <Toaster position="bottom-right" visibleToasts={4} />
    </ToastContext.Provider>
  );
}

/** Throws outside the provider rather than no-opping — feedback that silently
 * does nothing is the exact problem this exists to fix. */
export function useToasts(): ToastApi {
  const api = useContext(ToastContext);
  if (api === null) {
    throw new Error('useToasts must be used inside <ToastProvider>');
  }
  return api;
}
