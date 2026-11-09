// Module `core`'s data half (engine plan §3.2): the kernel's own mechanics - taps, inserts, locks, triggers, section
// entries - as the data registry's first entry. Its world keys are the kernel decoder's own (world/decode.ts), so it
// owns none of them here: the composed decoder routes an owned key to its module's `decode`, and the kernel keys stay
// the kernel's. Its four `fired` prefixes (`enter`, `then`, `open`, `fail`) stay the kernel's `triggerOf`
// (explore/reconcile.ts), since `owns.trigger` holds one prefix. Its facts are the kernel's, normalized by reconcile's
// kernel steps, so its `normalize` is the identity. It owns the kernel fact kinds, so a module that claims one fails
// `mechanics: every key has one owner`.
import { KERNEL_FACT_KINDS } from '../contract.ts';
import type { MechanicData } from '../contract.ts';

export const core = {
  id: 'core',
  rules: 'chunk',
  owns: { facts: KERNEL_FACT_KINDS },
  decode: () => ({ ok: true, value: null }),
  encode: () => [],
  normalize: (_w, s) => s,
} satisfies MechanicData<'core', null>;
