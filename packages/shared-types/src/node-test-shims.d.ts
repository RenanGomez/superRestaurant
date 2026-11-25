declare module "node:test" {
  type TestFunction = () => void | Promise<void>;
  export default function test(name: string, fn: TestFunction): void;
}

declare module "node:assert/strict" {
  interface StrictAssert {
    deepEqual(actual: unknown, expected: unknown, message?: string): void;
    equal(actual: unknown, expected: unknown, message?: string): void;
    ok(value: unknown, message?: string): asserts value;
  }
  const assert: StrictAssert;
  export default assert;
}
