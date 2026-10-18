import { createRequire } from "node:module";
import * as dates from "../../../client/src/utils/formatDateTime.js";
const require = createRequire(new URL("../../../client/package.json", import.meta.url));
const React = require("react");

// Dependency boundaries for existing component-only harnesses. The real focus
// hook and overflow measurement are exercised separately in DEA-20 interactions.
export const sharedClientImports = {
  ...dates,
  useDialogFocus() {},
  ResponsiveTable: ({ label, children, className }) => React.createElement("div", {
    role: "region", "aria-label": label, className,
  }, children),
};
