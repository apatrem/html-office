// Dialogs of the editor, on the shared shell's native <dialog>.
import { h } from '../../packages/shared/shell/dom.mjs';
import { modal, field } from '../../packages/shared/shell/dialogs.mjs';

// Table › Column width: a whole percentage of the table's width, or automatic (empty).
// onSave(n): n is 1–100 or null.
export function columnWidthDialog(current, onSave) {
  const input = h('input', { type: 'number', min: '1', max: '100', step: '1', value: current ?? '', inputmode: 'numeric' });
  const ok = h('button', { type: 'button', class: 'sh-b sh-t sh-primary' }, 'Set width');
  const box = field('Width in % of the table (empty: automatic)', input);
  const dialog = modal('Column width', [box], [
    h('span', { class: 'sh-spacer' }),
    h('button', { type: 'button', class: 'sh-b sh-t sh-ghost', onclick: () => dialog.close('cancel') }, 'Cancel'),
    ok
  ]);
  ok.addEventListener('click', () => {
    const text = input.value.trim(), n = text ? Number(text) : null;
    if (n !== null && !(Number.isInteger(n) && n >= 1 && n <= 100)) {
      box.querySelector('.sh-err').textContent = 'Enter a whole number from 1 to 100, or leave it empty.';
      return;
    }
    dialog.close('save');
    onSave(n);
  });
  input.focus();
}
