import type { ConfigPatch, DispatchConfig } from '@dispatch/core/browser';
import { QUEUE_FACTORS, queueWeights } from '@dispatch/core/browser';

import { NumberSetting } from './fields';
import { SettingsGroup, SettingsRow } from './SettingsGroup';

interface Props {
  config: DispatchConfig;
  onSave: (patch: ConfigPatch) => Promise<void>;
}

/**
 * Settings → Autonomy → What runs next: how much each factor counts when
 * Dispatch ranks the ready tasks. A weight of 0 leaves a factor out.
 */
export function QueueWeightsGroup({ config, onSave }: Props) {
  const result = queueWeights(config);
  const hint =
    'How much each factor counts when ready tasks are ranked. 0 leaves one out; the ranking is a weighted average, so only the proportions matter.';
  if ('error' in result) {
    return (
      <SettingsGroup title="What runs next" hint={hint}>
        <SettingsRow
          title="The weights in config.yml could not be read"
          subtitle={result.error}
        />
      </SettingsGroup>
    );
  }
  const { weights } = result;
  return (
    <SettingsGroup title="What runs next" hint={hint}>
      {QUEUE_FACTORS.map((factor) => (
        <NumberSetting
          key={factor.key}
          id={`queue-weight-${factor.key}`}
          title={factor.label}
          subtitle={`Counts ${factor.describes}.`}
          value={weights[factor.key]}
          min={0}
          integer={false}
          onSave={(n) =>
            n !== null &&
            void onSave({ queue: { weights: { [factor.key]: n } } })
          }
        />
      ))}
    </SettingsGroup>
  );
}
