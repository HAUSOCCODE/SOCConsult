import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
const requireClient = createRequire(
  new URL("../../client/package.json", import.meta.url),
);
const React = requireClient("react");
const { renderToString } = requireClient("react-dom/server");
const { transform } = requireClient("esbuild");
async function load(name, imports = {}) {
  const raw = await readFile(
    new URL(
      `../../client/src/components/accounts/${name}.jsx`,
      import.meta.url,
    ),
    "utf8",
  );
  const body = raw
    .replace(/^import.*$/gm, "")
    .replace("export default function", "function");
  const compiled = await transform(body, { loader: "jsx", jsx: "transform" });
  return new Function(
    "React",
    ...Object.keys(imports),
    `${compiled.code}; return ${name};`,
  )(React, ...Object.values(imports));
}
test("preview renders counts and errors and never enables creation", async () => {
  const CSVErrorTable = await load("CSVErrorTable");
  const Component = await load("CSVValidationPreview", { CSVErrorTable });
  for (const valid of [true, false]) {
    const preview = {
      expiresAt: new Date(Date.now() + 60000).toISOString(),
      canConfirm: valid,
      summary: {
        totalRows: 1,
        validRows: valid ? 1 : 0,
        invalidRows: valid ? 0 : 1,
        duplicateRows: valid ? 0 : 1,
      },
      rows: [
        {
          dataRowNumber: 1,
          rowNumber: 2,
          endLineNumber: 2,
          institutional_id: "0001",
          fullName: "Juan Santos",
          official_email: "j@student.hau.edu.ph",
          role: "student",
          valid,
          errors: valid ? [] : [{ message: "ID conflict" }],
        },
      ],
    };
    const html = renderToString(React.createElement(Component, { preview }));
    assert.match(html, /Duplicate\/conflict rows/);
    assert.match(html, /0001/);
    if (valid) {
      assert.match(html, /disabled=""/);
      assert.match(html, /available in DEA-07/);
    } else {
      assert.match(html, /ID conflict/);
      assert.doesNotMatch(html, /<button/);
    }
    assert.doesNotMatch(html, /password/i);
  }
});
