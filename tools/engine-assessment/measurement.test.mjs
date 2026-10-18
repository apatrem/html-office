import test from 'node:test';
import assert from 'node:assert/strict';
import {serialiseRows, comparable} from './measurement.mjs';

test('CSV preserves quoted, multiline and Unicode cells and JSON retains their types', () => {
  const {csv, json} = serialiseRows(['label', 'amount'], [['Café, "North"\nannex', 12.5], ['0012', null]]);
  assert.equal(csv, 'label,amount\r\n"Café, ""North""\nannex",12.5\r\n0012,\r\n');
  assert.deepEqual(JSON.parse(json), {
    A1: {value: 'label'}, B1: {value: 'amount'},
    A2: {value: 'Café, "North"\nannex'}, B2: {value: 12.5},
    A3: {value: '0012'}, B3: {value: null}
  });
});

test('raw-data JSON uses proper sheet addresses beyond column Z', () => {
  const {json} = serialiseRows(Array.from({length: 27}, (_, i) => `col${i}`), [Array(27).fill(0)]);
  assert.deepEqual(JSON.parse(json).AA2, {value: 0});
});

test('baseline checks ignore environment/compression differences but detect changed inputs and sizes', () => {
  const before = {environment: {node: 'v22'}, item: {bytes: 12, tokens: 3, sha256: 'a', gzipBytes: 8, brotliBytes: 7}};
  const compressionOnly = {environment: {node: 'v26'}, item: {...before.item, gzipBytes: 9, brotliBytes: 8}};
  assert.deepEqual(comparable(before), comparable(compressionOnly));
  assert.notDeepEqual(comparable(before), comparable({...before, item: {...before.item, sha256: 'b'}}));
  assert.notDeepEqual(comparable(before), comparable({...before, item: {...before.item, bytes: 13}}));
});
