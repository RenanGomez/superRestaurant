import assert from "node:assert/strict";
import test from "node:test";
import { EscPosEncoder } from "./escpos.js";

test("ESC/POS commands emit exact bytes and bytes() is detached", () => {
  const encoder = new EscPosEncoder().init().align("left").align("center").align("right")
    .bold(true).bold(false).line("OK").feed(2).cut("partial").cut("full")
    .raw(Uint8Array.of(0x41, 0x42));
  const expected = [
    0x1b, 0x40, 0x1b, 0x74, 0x10,
    0x1b, 0x61, 0, 0x1b, 0x61, 1, 0x1b, 0x61, 2,
    0x1b, 0x45, 1, 0x1b, 0x45, 0,
    0x4f, 0x4b, 0x0a, 0x1b, 0x64, 2,
    0x1d, 0x56, 1, 0x1d, 0x56, 0, 0x41, 0x42,
  ];
  assert.deepEqual([...encoder.bytes()], expected);
  const copy = encoder.bytes();
  copy[0] = 0;
  assert.deepEqual([...encoder.bytes()], expected);
  assert.throws(() => encoder.feed(256), RangeError);
});

test("CP1252 maps Spanish glyphs and blocks command injection in text", () => {
  assert.deepEqual([...new EscPosEncoder().text("á é í ó ú ñ Ñ ¿ ¡").bytes()],
    [0xe1, 0x20, 0xe9, 0x20, 0xed, 0x20, 0xf3, 0x20, 0xfa, 0x20,
      0xf1, 0x20, 0xd1, 0x20, 0xbf, 0x20, 0xa1]);
  assert.deepEqual([...new EscPosEncoder().text("A\x1b\n😀").bytes()], [0x41, 0x3f, 0x3f, 0x3f]);
});
