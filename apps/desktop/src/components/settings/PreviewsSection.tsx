import type { ConfigPatch, DispatchConfig } from '@dispatch/core/browser';
import { previewSettings } from '@dispatch/core/browser';

import {
  NumberSetting,
  OPERATOR_ONLY,
  SwitchSetting,
  TextSetting,
} from './fields';
import { SettingsGroup } from './SettingsGroup';

interface Props {
  config: DispatchConfig;
  onSave: (patch: ConfigPatch) => Promise<void>;
  canOperate: boolean;
}

/**
 * Settings → Previews: whether a task's Preview tab may start the run's dev
 * server, and how. The commands run inside the run's worktree on this
 * machine, so only whoever runs the daemon changes them.
 */
export function PreviewsSection({ config, onSave, canOperate }: Props) {
  // The block is optional in a config; this fills in its defaults.
  const preview = previewSettings(config);
  const locked = canOperate ? undefined : OPERATOR_ONLY;
  return (
    <>
      <SettingsGroup
        title="Live previews"
        hint="A run's dev server, started from its own worktree when someone presses Start on the Preview tab."
      >
        <SwitchSetting
          id="preview-enabled"
          title="Allow previews"
          checked={preview.enabled}
          onSave={(enabled) => void onSave({ preview: { enabled } })}
        />
        <TextSetting
          id="preview-command"
          title="Dev server command"
          subtitle="Empty uses the worktree's package.json: its dev script, else start."
          value={preview.command}
          placeholder="pnpm dev --port $PORT"
          mono
          locked={locked}
          onSave={(command) => void onSave({ preview: { command } })}
        />
        <TextSetting
          id="preview-install"
          title="Install command"
          subtitle="Run once before the dev server when the worktree has no node_modules — a run's worktree is a fresh checkout."
          value={preview.installCommand}
          placeholder="pnpm install"
          mono
          locked={locked}
          onSave={(installCommand) =>
            void onSave({ preview: { installCommand } })
          }
        />
      </SettingsGroup>
      <SettingsGroup title="Timing">
        <NumberSetting
          id="preview-ready"
          title="Time to start"
          subtitle="How long the dev server has to answer before the preview is reported as failed. Empty restores the default."
          value={preview.readyTimeoutSec}
          suffix="s"
          allowEmpty
          onSave={(readyTimeoutSec) =>
            void onSave({ preview: { readyTimeoutSec } })
          }
        />
        <NumberSetting
          id="preview-idle"
          title="Stop when unused for"
          subtitle="An idle dev server is pure cost; it is swept after this long with no request. Empty restores the default."
          value={preview.idleTimeoutSec}
          suffix="s"
          allowEmpty
          onSave={(idleTimeoutSec) =>
            void onSave({ preview: { idleTimeoutSec } })
          }
        />
      </SettingsGroup>
    </>
  );
}
