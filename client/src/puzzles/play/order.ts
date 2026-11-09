// The `order` puzzle's play half (engine plan §7.1): chunk code, imported only by its type UI (`rules-lazy`). Pure.
import { shapeProblem } from '../rules/index.ts';
import type { PuzzleTypePlay } from '../rules/index.ts';
import { ORDER_RULES } from '../rules/order.ts';
import type { OrderParams } from '../rules/order.ts';

export const ORDER_PLAY: PuzzleTypePlay<OrderParams> = Object.freeze({
  // A piece index per slot may be tried: whether the order is right is the server's (X5).
  validAnswer: (p: OrderParams, a: readonly number[]) => shapeProblem(a, ORDER_RULES.answerShape(p)) === null,
});
