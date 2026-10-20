import { readFile } from "node:fs/promises";
export const CONFORMANCE_FAMILIES = ["aggregation-logic", "lookup-text-number"];
export async function conformanceFixture(family) {
  const fixture = JSON.parse(
    await readFile(
      new URL(`conformance/${family}.json`, import.meta.url),
      "utf8",
    ),
  );
  const book = {
    version: "html-data/0.1",
    id: `conformance-${family}`,
    title: `Fictional ${family} conformance fixtures`,
    dateSystem: "excel1900",
    locale: "en-US",
    groups: [],
    names: [],
    metadata: { fictional: true, conformance: fixture.provenance },
    sheets: fixture.cases.map((c, i) => ({
      id: `case_${i + 1}`,
      name: `Case ${i + 1}`,
      cells: {
        ...structuredClone(fixture.inputs),
        ...structuredClone(c.inputs ?? {}),
        H1: { formula: c.formula },
      },
    })),
  };
  return { fixture, book };
}
export function conformanceDifferences(book, fixture) {
  const differences = [];
  for (const [i, c] of fixture.cases.entries()) {
    const actual = book.sheets[i].cells.H1?.result,
      expected = c.expected;
    if (
      actual?.type !== expected.type ||
      (expected.type === "number"
        ? Math.abs(actual.value - expected.value) > (c.tolerance ?? 0)
        : actual.value !== expected.value)
    )
      differences.push({ case: c.id, formula: c.formula, expected, actual });
  }
  return differences;
}
