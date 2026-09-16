/** The categorical palette a label's 8px dot draws from — the same eight hues epics and
 * projects hash into, so a label never lands on a `--state-*` colour and reads as a run state. */
const LABEL_COLOR_COUNT = 8;

/** Deterministically maps a label name to one of the `--project-color-1..8` tokens, so `ui`
 * is the same hue on every pill without anyone storing a colour per label. */
export function colorForLabel(label: string): string {
  let hash = 0;
  for (let i = 0; i < label.length; i++) {
    hash = (hash * 33 + label.charCodeAt(i)) >>> 0;
  }
  return `var(--project-color-${(hash % LABEL_COLOR_COUNT) + 1})`;
}
