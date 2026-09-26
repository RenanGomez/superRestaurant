/** CP1252 is selected with ESC t 16 (Epson WPC1252). Unsupported glyphs become '?'. */
const cp1252Extras = new Map<string, number>([
  ["€", 0x80], ["‚", 0x82], ["ƒ", 0x83], ["„", 0x84], ["…", 0x85],
  ["†", 0x86], ["‡", 0x87], ["ˆ", 0x88], ["‰", 0x89], ["Š", 0x8a],
  ["‹", 0x8b], ["Œ", 0x8c], ["Ž", 0x8e], ["‘", 0x91], ["’", 0x92],
  ["“", 0x93], ["”", 0x94], ["•", 0x95], ["–", 0x96], ["—", 0x97],
  ["˜", 0x98], ["™", 0x99], ["š", 0x9a], ["›", 0x9b], ["œ", 0x9c],
  ["ž", 0x9e], ["Ÿ", 0x9f],
]);

function encodeCp1252(value: string): number[] {
  return Array.from(value, (character) => {
    const code = character.codePointAt(0)!;
    // Never let user text inject ESC/POS commands or control bytes.
    if (code < 0x20 || code === 0x7f) return 0x3f;
    if (code <= 0x7e || (code >= 0xa0 && code <= 0xff)) return code;
    return cp1252Extras.get(character) ?? 0x3f;
  });
}

export class EscPosEncoder {
  private readonly output: number[] = [];

  public init(): this {
    this.output.push(0x1b, 0x40, 0x1b, 0x74, 0x10);
    return this;
  }

  public align(value: "left" | "center" | "right"): this {
    this.output.push(0x1b, 0x61, { left: 0, center: 1, right: 2 }[value]);
    return this;
  }

  public bold(enabled: boolean): this {
    this.output.push(0x1b, 0x45, enabled ? 1 : 0);
    return this;
  }

  public text(value: string): this {
    this.output.push(...encodeCp1252(value));
    return this;
  }

  public line(value = ""): this {
    this.text(value);
    this.output.push(0x0a);
    return this;
  }

  public feed(count: number): this {
    if (!Number.isInteger(count) || count < 0 || count > 255) throw new RangeError("feed count must be an integer from 0 to 255");
    this.output.push(0x1b, 0x64, count);
    return this;
  }

  public cut(value: "partial" | "full"): this {
    this.output.push(0x1d, 0x56, value === "partial" ? 1 : 0);
    return this;
  }

  public raw(bytes: Uint8Array): this {
    this.output.push(...bytes);
    return this;
  }

  /** Returns a detached byte copy; Uint8Array itself cannot be frozen. */
  public bytes(): Uint8Array {
    return Uint8Array.from(this.output);
  }
}
