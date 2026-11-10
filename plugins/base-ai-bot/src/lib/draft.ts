import { createSignal } from 'solid-js';

/** Shared composer draft so quick-actions and other UI can prefill it. */
const [draft, setDraft] = createSignal('');
export { draft, setDraft };

let focusComposer: (() => void) | null = null;

export function registerComposerFocus(fn: () => void): void {
  focusComposer = fn;
}

export function prefillComposer(value: string): void {
  setDraft(value);
  focusComposer?.();
}
