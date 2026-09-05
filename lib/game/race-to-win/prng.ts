/**
 * Small, explicit LCG. Do not replace it with Math.random(): run replay and
 * later server validation depend on this exact sequence.
 */
export class RaceToWinPrng {
  private state: number;

  public constructor(seed: number) {
    this.state = seed >>> 0;
  }

  public nextUint32(): number {
    this.state = (Math.imul(this.state, 1_664_525) + 1_013_904_223) >>> 0;
    return this.state;
  }

  public next(): number {
    return this.nextUint32() / 4_294_967_296;
  }

  public intInclusive(minimum: number, maximum: number): number {
    if (!Number.isInteger(minimum) || !Number.isInteger(maximum) || maximum < minimum) {
      throw new Error("Invalid deterministic integer range.");
    }

    return minimum + Math.floor(this.next() * (maximum - minimum + 1));
  }

  public pick<T>(items: readonly T[]): T {
    if (items.length === 0) {
      throw new Error("Cannot pick from an empty deterministic collection.");
    }

    return items[this.intInclusive(0, items.length - 1)]!;
  }
}
