// Review defect 6: TODAY() and NOW() follow the local time zone although the
// pinned engine binding runs in UTC, and results that use them are marked
// when they date from an earlier day.
import test from "node:test";
import assert from "node:assert/strict";
import { EngineSession, zoneOffset } from "../engine/adapter.mjs";
import { loadEngine } from "../tools/engine-node.mjs";
import { volatileFunctions, volatileNotice } from "../model/snapshots.mjs";

const book = (cells) => ({
  version: "html-data/0.1",
  id: "b",
  title: "t",
  dateSystem: "excel1900",
  locale: "en-US",
  sheets: [{ id: "s", name: "Sheet1", cells }],
  groups: [],
  names: [],
});
// 22 November 2026, 23:30 UTC: already the 23rd in Auckland and Tokyo.
const instant = Date.UTC(2026, 10, 22, 23, 30);
async function today(timeZone, run = (f) => f()) {
  const session = new EngineSession(await loadEngine(), { timeZone });
  try {
    session.load(
      book({ A1: { formula: "=TODAY()" }, A2: { formula: "=NOW()" } }),
    );
    const { results } = await run(() => session.calculateDelta());
    return results.map((r) => r.result.value);
  } finally {
    session.dispose();
  }
}
async function at(now, f) {
  const real = Date.now;
  Date.now = () => now;
  try {
    return await f();
  } finally {
    Date.now = real;
  }
}

test("time zone offsets follow the zone, daylight saving included", () => {
  assert.equal(zoneOffset(instant, "UTC"), 0);
  assert.equal(zoneOffset(instant, "Asia/Tokyo"), 9 * 3600e3);
  assert.equal(zoneOffset(instant, "Europe/Paris"), 3600e3);
  assert.equal(zoneOffset(Date.UTC(2026, 6, 1), "Europe/Paris"), 2 * 3600e3);
  assert.equal(zoneOffset(instant, "America/Los_Angeles"), -8 * 3600e3);
  assert.equal(
    zoneOffset(instant),
    -new Date(instant).getTimezoneOffset() * 60000,
  );
});

test("TODAY and NOW give the date and time of the zone, not of UTC", async () => {
  const serial = 46348; // 22 November 2026
  await at(instant, async () => {
    assert.deepEqual(await today("UTC"), [serial, serial + 23.5 / 24]);
    // Tokyo and Auckland are already on the 23rd; Los Angeles is on the 22nd.
    assert.equal((await today("Asia/Tokyo"))[0], serial + 1);
    assert.equal((await today("Pacific/Auckland"))[0], serial + 1);
    assert.deepEqual(await today("America/Los_Angeles"), [
      serial,
      serial + 15.5 / 24,
    ]);
  });
});

test("the shifted clock is restored, also when evaluation fails", async () => {
  const real = Date.now;
  await at(instant, async () => {
    const session = new EngineSession(await loadEngine(), {
      timeZone: "Asia/Tokyo",
    });
    try {
      session.load(book({ A1: { formula: "=TODAY()" } }));
      const mocked = Date.now;
      await session.calculateDelta();
      assert.equal(Date.now, mocked);
      const engine = session.engine;
      session.engine = {
        evaluate: () => assert.equal(Date.now() - instant, 9 * 3600e3),
      };
      session.evaluate();
      assert.equal(Date.now, mocked);
      session.engine = {
        evaluate: () => {
          throw new Error("boom");
        },
      };
      assert.throws(() => session.evaluate(), /boom/);
      assert.equal(Date.now, mocked);
      session.engine = engine;
    } finally {
      session.dispose();
    }
  });
  assert.equal(Date.now, real);
});

test("a snapshot's own timestamp is the real time, not the shifted clock", async () => {
  const session = new EngineSession(await loadEngine(), {
    timeZone: "Pacific/Auckland",
  });
  try {
    session.load(book({ A1: { formula: "=TODAY()" } }));
    const before = Date.now(),
      { snapshot } = await session.calculateDelta();
    const stamped = Date.parse(snapshot.calculatedAt);
    assert.ok(stamped >= before - 1000 && stamped <= Date.now() + 1000);
  } finally {
    session.dispose();
  }
});

test("volatile functions are found outside text only", () => {
  const model = book({
    A1: { formula: "=TODAY()+1" },
    A2: { formula: '=IF(A1>0,"NOW()",RAND ())' },
    A3: { formula: '="RANDBETWEEN("' },
    A4: { formula: "=SUM(A1:A2)" },
    A5: { formula: "=RANDBETWEEN(1,6)" },
    A6: { input: { type: "text", value: "=NOW()" } },
  });
  assert.deepEqual(volatileFunctions(model), ["RAND", "RANDBETWEEN", "TODAY"]);
  assert.deepEqual(
    volatileFunctions(book({ A1: { formula: "=ROUND(1.5,0)" } })),
    [],
  );
});

test("results from an earlier day are marked, never results from today", () => {
  const model = book({
    A1: { formula: "=TODAY()" },
    A2: { formula: "=RAND()" },
  });
  model.snapshot = {
    engine: "x",
    fingerprint: "0".repeat(64),
    calculatedAt: "2026-11-21T10:00:00.000Z",
  };
  const now = new Date(2026, 10, 23, 9, 0);
  assert.match(
    volatileNotice(model, now),
    /^Saved results are current, but RAND\(\) and TODAY\(\) show the value calculated on Nov 2[12], 2026\. Recalculate to refresh them\.$/,
  );
  assert.equal(
    volatileNotice(model, new Date(model.snapshot.calculatedAt)),
    null,
  );
  assert.equal(
    volatileNotice(
      { ...model, sheets: book({ A1: { formula: "=A2" } }).sheets },
      now,
    ),
    null,
  );
  assert.equal(
    volatileNotice(book({ A1: { formula: "=TODAY()" } }), now),
    null,
  );
});
