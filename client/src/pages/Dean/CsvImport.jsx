import { Link } from "react-router-dom";

export default function CsvImport() {
  const columns = [
    [
      "institutional_id",
      "Required",
      "Institutional account ID. Keep as text, including leading zeros.",
    ],
    ["first_name", "Required", "First name."],
    ["middle_name", "Optional value", "Middle name. An empty value is valid."],
    ["last_name", "Required", "Last name."],
    [
      "official_email",
      "Required",
      "Official email address; normalized to lowercase.",
    ],
    [
      "role",
      "Required",
      "student or faculty only; normalized to lowercase. Dean is not allowed.",
    ],
  ];

  return (
    <section className="rounded-2xl border bg-white p-4 sm:p-6">
      <h2 className="text-xl font-bold text-maroon-900">CSV Import</h2>
      <p className="mt-3 text-sm text-slate-600">
        Download the project-defined sample template for development and
        testing. CSV upload and preview will be implemented in DEA-06; account
        creation will be implemented in DEA-07.
      </p>
      <a
        className="btn-primary mt-5 inline-flex"
        href="/templates/socconsult-account-import-template.csv"
        download="socconsult-account-import-template.csv"
      >
        Download CSV template
      </a>
      <div className="mt-5 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <caption className="mb-3 text-left text-slate-600">
            Include all six columns in this order. Trim surrounding whitespace;
            required values must not be empty or contain only whitespace.
          </caption>
          <thead>
            <tr>
              <th className="p-2">Column</th>
              <th className="p-2">Requirement</th>
              <th className="p-2">Description</th>
            </tr>
          </thead>
          <tbody>
            {columns.map(([column, requirement, description]) => (
              <tr key={column} className="border-t">
                <td className="p-2 font-mono">{column}</td>
                <td className="p-2">{requirement}</td>
                <td className="p-2">{description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Link className="btn-secondary mt-5 inline-flex" to="/dean/dashboard">
        Back to Dean Management
      </Link>
    </section>
  );
}
