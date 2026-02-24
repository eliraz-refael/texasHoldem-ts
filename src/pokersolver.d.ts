declare module "pokersolver" {
  class Hand {
    name: string;
    descr: string;
    rank: number;
    cards: { value: string; suit: string }[];
    static solve(
      cards: string[],
      game?: string,
      canDisqualify?: boolean,
    ): Hand;
    static winners(hands: Hand[]): Hand[];
    toString(): string;
  }
  const _default: { Hand: typeof Hand };
  export default _default;
  export { Hand };
}
