import ProfileForm, {
  SecuritySettings,
} from "../../components/profile/ProfileForm";

export default function StudentAccountSettings() {
  return (
    <div className="space-y-6">
      <ProfileForm />
      <SecuritySettings />
    </div>
  );
}
