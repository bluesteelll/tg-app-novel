// The data registry (engine plan §3.2): every module's engine half, in one order the rules registry
// (mechanics/rules/index.ts) follows for the modules that have a rules half (`mechanics: data and rules registries
// align`). Each module lane appends its entry.
import type { MechanicData } from '../contract.ts';
import { core } from './core.ts';

export const MECHANIC_DATA = [core] as const;

/** A data registry as a decode takes it: `MECHANIC_DATA`, or a test's fixture modules beside it. */
export type DataRegistry = readonly MechanicData<string, unknown, unknown>[];
