// The data registry (engine plan §3.2): every module's engine half, in one order the rules registry
// (mechanics/rules/index.ts) follows for the modules that have a rules half (`mechanics: data and rules registries
// align`). Each module lane appends its entry.
import { core } from './core.ts';

export const MECHANIC_DATA = [core] as const;
