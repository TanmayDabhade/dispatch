import type {
  CartoMode,
  ConfigPatch,
  DispatchConfig,
} from '@dispatch/core/browser';
import { DEFAULT_RECEIPTS_BRANCH } from '@dispatch/core/browser';
import { useEffect, useState } from 'react';

import {
  ChoiceSetting,
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

type Place = 'remote' | 'repo';

/** Where a push goes, as the one choice a person makes. */
function placeOf(target: { repo?: string }): Place {
  return target.repo === undefined ? 'remote' : 'repo';
}

/**
 * What choosing where board sync goes writes right away: going back to the
 * project's repo clears a repo of its own; choosing a repo of its own writes
 * nothing yet (null), since it has no URL until one is typed.
 */
export function syncPlacePatch(
  place: Place,
  current: { repo?: string }
): NonNullable<ConfigPatch['sync']> | null {
  if (place === 'remote')
    return current.repo === undefined ? null : { repo: null };
  return null;
}

/** The same for the receipt log, which may also go nowhere. */
export function receiptsPlacePatch(
  place: Place | 'off',
  current: { remote?: string; repo?: string }
): NonNullable<ConfigPatch['receipts']> | null {
  if (place === 'off') {
    return current.remote === undefined && current.repo === undefined
      ? null
      : { remote: null, repo: null };
  }
  if (place === 'remote') {
    return current.remote !== undefined && current.repo === undefined
      ? null
      : { repo: null, remote: current.remote ?? 'origin' };
  }
  return null;
}

/** What entering a repo of its own writes: that repo, and never a remote
 *  beside it, since the two are exclusive. */
export function ownRepoPatch(repo: string | null): {
  remote?: null;
  repo: string | null;
} {
  return repo === null ? { repo } : { remote: null, repo };
}

/**
 * The daemon's own jobs, on Settings → Daemon: sharing the board with
 * teammates' daemons, keeping the receipt log (and where it is pushed), the
 * code map, and the repo digest. Where anything is pushed is the owner's
 * call alone.
 */
export function DaemonConfigGroups({ config, onSave, canOperate }: Props) {
  const locked = canOperate ? undefined : OPERATOR_ONLY;
  const sync = config.sync ?? {
    enabled: false,
    remote: 'origin',
    branch: 'dispatch-sync',
    intervalSec: 30,
  };
  const receipts = config.receipts ?? { enabled: true };
  const pushes = receipts.remote !== undefined || receipts.repo !== undefined;
  // The choice is held here, not read back from config, until it can be
  // saved: picking "a repo of its own" has nothing to write until a URL is
  // typed, and writing an empty one would snap the choice straight back.
  const savedSyncPlace = placeOf(sync);
  const savedReceiptsPlace: Place | 'off' = pushes ? placeOf(receipts) : 'off';
  const [syncPlace, setSyncPlace] = useState<Place>(savedSyncPlace);
  const [receiptsPlace, setReceiptsPlace] = useState<Place | 'off'>(
    savedReceiptsPlace
  );
  // Follows the config when it changes underneath (a save, another window).
  useEffect(() => setSyncPlace(savedSyncPlace), [savedSyncPlace]);
  useEffect(() => setReceiptsPlace(savedReceiptsPlace), [savedReceiptsPlace]);

  return (
    <>
      <SettingsGroup
        title="Board sync settings"
        hint="Changes here take effect when the daemon restarts."
      >
        <SwitchSetting
          id="sync-enabled"
          title="Share this board with teammates' daemons"
          checked={sync.enabled}
          onSave={(enabled) => void onSave({ sync: { enabled } })}
        />
        <ChoiceSetting
          id="sync-place"
          title="Where the board travels"
          value={syncPlace}
          locked={locked}
          choices={[
            { value: 'remote', label: "This project's repo" },
            { value: 'repo', label: 'A repo of its own' },
          ]}
          onSave={(place) => {
            setSyncPlace(place);
            const patch = syncPlacePatch(place, sync);
            if (patch !== null) void onSave({ sync: patch });
          }}
        />
        {syncPlace === 'remote' ? (
          <TextSetting
            id="sync-remote"
            title="Remote"
            subtitle="One of this project's git remotes, by name."
            value={sync.remote}
            placeholder="origin"
            mono
            locked={locked}
            onSave={(remote) => void onSave({ sync: { remote } })}
          />
        ) : (
          <TextSetting
            id="sync-repo"
            title="Repo"
            subtitle="A git URL, or a path relative to the project."
            value={sync.repo}
            placeholder="git@github.com:acme/dispatch-board.git"
            mono
            locked={locked}
            onSave={(repo) => void onSave({ sync: ownRepoPatch(repo) })}
          />
        )}
        <TextSetting
          id="sync-branch"
          title="Branch"
          subtitle="Nothing but sync writes to it. In a repo shared by several projects, give each its own."
          value={sync.branch}
          placeholder="dispatch-sync"
          mono
          onSave={(branch) => void onSave({ sync: { branch } })}
        />
        <NumberSetting
          id="sync-interval"
          title="Check for teammates' changes every"
          value={sync.intervalSec}
          min={5}
          suffix="s"
          allowEmpty
          onSave={(intervalSec) => void onSave({ sync: { intervalSec } })}
        />
      </SettingsGroup>

      <SettingsGroup
        title="Receipt log"
        hint="The audit trail as plain files in git: every task, finding, decision and piece of run evidence."
      >
        <SwitchSetting
          id="receipts-enabled"
          title="Keep the receipt log"
          checked={receipts.enabled}
          onSave={(enabled) => void onSave({ receipts: { enabled } })}
        />
        <TextSetting
          id="receipts-dir"
          title="Folder"
          subtitle="Empty keeps the default under the Dispatch home. A relative path is read from the project."
          value={receipts.dir}
          mono
          locked={locked}
          onSave={(dir) => void onSave({ receipts: { dir } })}
        />
        <ChoiceSetting
          id="receipts-place"
          title="Push it after each change to"
          value={receiptsPlace}
          locked={locked}
          choices={[
            { value: 'off', label: 'Nowhere (this machine only)' },
            { value: 'remote', label: "This project's repo" },
            { value: 'repo', label: 'A repo of its own' },
          ]}
          onSave={(place) => {
            setReceiptsPlace(place);
            const patch = receiptsPlacePatch(place, receipts);
            if (patch !== null) void onSave({ receipts: patch });
          }}
        />
        {receiptsPlace === 'remote' && (
          <TextSetting
            id="receipts-remote"
            title="Remote"
            value={receipts.remote}
            placeholder="origin"
            mono
            locked={locked}
            onSave={(remote) => void onSave({ receipts: { remote } })}
          />
        )}
        {receiptsPlace === 'repo' && (
          <TextSetting
            id="receipts-repo"
            title="Repo"
            value={receipts.repo}
            placeholder="git@github.com:acme/dispatch-audit.git"
            mono
            locked={locked}
            onSave={(repo) => void onSave({ receipts: ownRepoPatch(repo) })}
          />
        )}
        {receiptsPlace !== 'off' && (
          <TextSetting
            id="receipts-branch"
            title="Branch"
            subtitle="One machine per branch: each log is its own history."
            value={receipts.branch}
            placeholder={DEFAULT_RECEIPTS_BRANCH}
            mono
            onSave={(branch) => void onSave({ receipts: { branch } })}
          />
        )}
      </SettingsGroup>

      <SettingsGroup title="Background work">
        <ChoiceSetting<CartoMode>
          id="carto"
          title="Code map (Carto)"
          subtitle="The dependency graph behind what a change touches. Without carto the built-in scanner is used."
          value={config.carto.enabled}
          choices={[
            { value: 'detect', label: 'Use it if present' },
            { value: 'on', label: 'Use it, build it if needed' },
            { value: 'off', label: 'Built-in scanner only' },
          ]}
          onSave={(enabled) => void onSave({ carto: { enabled } })}
        />
        <SwitchSetting
          id="repo-digest"
          title="Repo digest"
          subtitle="A short summary of the repository, kept for agents' prompts."
          checked={config.repoDigest.enabled}
          onSave={(enabled) => void onSave({ repoDigest: { enabled } })}
        />
        <NumberSetting
          id="repo-digest-cooldown"
          title="Refresh the digest at most every"
          value={config.repoDigest.cooldownHours}
          suffix="hours"
          allowEmpty
          onSave={(cooldownHours) =>
            void onSave({ repoDigest: { cooldownHours } })
          }
        />
      </SettingsGroup>
    </>
  );
}
