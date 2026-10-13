export default function CSVErrorTable({ rows }) {
  return (
    <div className="mt-5 overflow-x-auto">
      <table className="w-full text-left text-sm">
        <caption className="mb-3 text-left">
          Validation results for every data row
        </caption>
        <thead>
          <tr>
            {[
              "Row number",
              "Institutional ID",
              "Full name",
              "Official email",
              "Role",
              "Validation result",
              "Errors",
            ].map((label) => (
              <th className="p-2" key={label}>
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr className="border-t" key={row.dataRowNumber}>
              <td className="p-2">
                {row.rowNumber}
                {row.endLineNumber !== row.rowNumber
                  ? `–${row.endLineNumber}`
                  : ""}
              </td>
              <td className="p-2">{row.institutional_id}</td>
              <td className="p-2">{row.fullName}</td>
              <td className="p-2">{row.official_email}</td>
              <td className="p-2">{row.role}</td>
              <td className="p-2">{row.valid ? "Valid" : "Invalid"}</td>
              <td className="p-2">
                {row.errors.map((error, index) => (
                  <p key={index}>{error.message}</p>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
