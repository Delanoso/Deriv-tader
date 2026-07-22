export type SymbolId =
  | "BOOM300N"
  | "BOOM900"
  | "BOOM1000"
  | "CRASH300N"
  | "CRASH900"
  | "CRASH1000";

export const SYMBOL_IDS: SymbolId[] = [
  "BOOM300N",
  "BOOM900",
  "BOOM1000",
  "CRASH300N",
  "CRASH900",
  "CRASH1000",
];

export const SYMBOL_DISPLAY: Record<SymbolId, string> = {
  BOOM300N: "Boom 300",
  BOOM900: "Boom 900",
  BOOM1000: "Boom 1000",
  CRASH300N: "Crash 300",
  CRASH900: "Crash 900",
  CRASH1000: "Crash 1000",
};

export function isBoomSymbol(symbol: SymbolId): boolean {
  return symbol.startsWith("BOOM");
}

export function emptySymbolRecord<T>(value: T): Record<SymbolId, T> {
  return {
    BOOM300N: value,
    BOOM900: value,
    BOOM1000: value,
    CRASH300N: value,
    CRASH900: value,
    CRASH1000: value,
  };
}

export function mapSymbols<T>(factory: (symbol: SymbolId) => T): Record<SymbolId, T> {
  const out = {} as Record<SymbolId, T>;
  for (const id of SYMBOL_IDS) out[id] = factory(id);
  return out;
}
