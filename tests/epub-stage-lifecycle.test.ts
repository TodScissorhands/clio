import { expect, test } from "bun:test";
import SourceStage from "epubjs/src/managers/helpers/stage.js";
import CompiledStage from "epubjs/lib/managers/helpers/stage.js";

for (const [name, Stage] of [["source", SourceStage], ["compiled", CompiledStage]] as const) {
  test(`${name} Stage teardown stops orientation callbacks without affecting other stages`, () => {
    const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    const events = new EventTarget();
    Object.defineProperty(globalThis, "window", { configurable: true, value: events });
    try {
      let unrelatedCalls = 0;
      events.addEventListener("orientationchange", () => { unrelatedCalls += 1; });
      for (let cycle = 0; cycle < 5; cycle++) {
        // Exercise the real registration/teardown methods; DOM creation is not
        // involved in the orientation-listener lifecycle under test.
        const stages = [0, 1].map(() => Object.assign(Object.create(Stage.prototype), {
          settings: {},
          element: { contains: () => false },
        }));
        const calls = [0, 0];
        stages.forEach((stage, index) => stage.onOrientationChange(() => { calls[index] += 1; }));
        events.dispatchEvent(new Event("orientationchange"));
        expect(calls).toEqual([1, 1]);

        stages[0].destroy();
        events.dispatchEvent(new Event("orientationchange"));
        expect(calls).toEqual([1, 2]);

        stages[1].destroy();
        events.dispatchEvent(new Event("orientationchange"));
        expect(calls).toEqual([1, 2]);
        expect(unrelatedCalls).toBe((cycle + 1) * 3);
      }
    } finally {
      if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
      else Reflect.deleteProperty(globalThis, "window");
    }
  });
}
