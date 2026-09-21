import type { KeyboardEvent } from 'react';
import { useState } from 'react';

import { Switch } from '@/ui/ai/switch';
import { Button } from '@/ui/button';
import {
  Dialog,
  DialogBody,
  DialogChrome,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@/ui/dialog';
import { Input } from '@/ui/input';

export interface SaveViewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** `create` names a new view (and can star it); `rename` only edits the name. */
  mode: 'create' | 'rename';
  initialName?: string;
  defaultFavorite?: boolean;
  onSubmit: (result: { name: string; favorite: boolean }) => void;
}

/** The name prompt behind "Save view" and "Rename view": a `Tasks › …` crumb, one name
 * field, a Favorite switch in create mode, Cancel / Save. `⌘⏎` submits; a blank name
 * cannot. The form mounts only while open, so a reopened dialog starts from its props. */
export function SaveViewDialog(props: SaveViewDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {props.open && <SaveViewForm {...props} />}
    </Dialog>
  );
}

function SaveViewForm({
  onOpenChange,
  mode,
  initialName = '',
  defaultFavorite = false,
  onSubmit,
}: SaveViewDialogProps) {
  const [name, setName] = useState(initialName);
  const [favorite, setFavorite] = useState(defaultFavorite);
  const trimmed = name.trim();
  const canSubmit = trimmed !== '';
  const verb = mode === 'rename' ? 'Rename view' : 'Save view';

  function submit() {
    if (!canSubmit) return;
    onSubmit({ name: trimmed, favorite: mode === 'create' && favorite });
    onOpenChange(false);
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.defaultPrevented) return;
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <DialogContent
      aria-label={verb}
      showCloseButton={false}
      onKeyDown={onKeyDown}
      className="w-[26rem] max-w-[calc(100vw-2rem)]"
    >
      <DialogChrome>
        <span>Tasks</span>
        <span aria-hidden>›</span>
        <span className="text-(--text-secondary)">{verb}</span>
      </DialogChrome>
      <DialogTitle className="sr-only">{verb}</DialogTitle>
      <DialogDescription className="sr-only">
        {mode === 'rename'
          ? 'Give this saved view a new name.'
          : 'Name the current filters and display as a view.'}
      </DialogDescription>
      <DialogBody className="gap-3 pt-1 pb-4">
        <Input
          aria-label="View name"
          placeholder="View name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
      </DialogBody>
      <DialogFooter
        className="shadow-hairline-top"
        leading={
          mode === 'create' && (
            <Switch
              label="Favorite"
              checked={favorite}
              onCheckedChange={(next) => setFavorite(next)}
            />
          )
        }
      >
        <Button variant="ghost" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button disabled={!canSubmit} onClick={submit}>
          Save
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
