import FacultyProfile from "./FacultyProfile";
import FacultySecuritySettings from "./FacultySecuritySettings";
export default function FacultyAccountSettings() {
  return (
    <div className="space-y-6">
      <FacultyProfile />
      <FacultySecuritySettings />
    </div>
  );
}
