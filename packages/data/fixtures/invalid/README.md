# Intentionally invalid reference workbooks

These are fictional test data, not authoring instructions or runnable documents.

- `unsupported-version.json`: rejected with `Invalid workbook header`.
- `active-cell-field.json`: rejected with `cell: unknown field onclick`.

The model test suite loads both fixtures and checks the expected validation error. Literal HTML-like text inside a typed text value is valid; an executable cell field is not.
