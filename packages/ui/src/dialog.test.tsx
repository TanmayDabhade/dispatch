import { render } from '@testing-library/react';
import { expect, test } from 'bun:test';

import { Dialog, DialogChrome, DialogContent, DialogTitle } from './dialog';

// A chrome row owns the close; the corner one stays in the tree as a fallback but
// carries the rule that hides it whenever a chrome row is inside the popup.
test('the corner close hides itself once a DialogChrome is present', () => {
  render(
    <Dialog open>
      <DialogContent>
        <DialogChrome>Tasks › New task</DialogChrome>
        <DialogTitle>New task</DialogTitle>
      </DialogContent>
    </Dialog>
  );
  const corner = document.querySelector('[data-slot="dialog-corner-close"]');
  expect(corner?.className).toContain(
    '[[data-slot=dialog-content]:has([data-slot=dialog-chrome])>&]:hidden'
  );
  expect(
    document.querySelectorAll('[data-slot="dialog-chrome"] [data-slot="dialog-close"]')
  ).toHaveLength(1);
});

test('showCloseButton={false} drops the corner close entirely', () => {
  render(
    <Dialog open>
      <DialogContent showCloseButton={false}>
        <DialogTitle>Plain</DialogTitle>
      </DialogContent>
    </Dialog>
  );
  expect(document.querySelector('[data-slot="dialog-corner-close"]')).toBeNull();
});
