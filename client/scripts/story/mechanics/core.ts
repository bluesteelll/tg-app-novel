// Module `core`'s world lint entry (engine plan §3.2): a per-world pass with no codes yet. The kernel's own world rules
// are lintWorld's (world.ts) with LINT_CODES; GM2b adds the `renamed` codes here.
import type { WorldLint } from './index.ts';

export const CORE_LINT = { id: 'core', codes: {}, lint: () => [] } satisfies WorldLint<never>;
