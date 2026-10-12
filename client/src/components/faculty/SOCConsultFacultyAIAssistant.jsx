import SOCConsultAIAssistant from "../dean/SOCConsultAIAssistant";

export default function SOCConsultFacultyAIAssistant() {
  return <SOCConsultAIAssistant
    endpoint="/faculty/ai/chat"
    title="SOCConsult Faculty AI"
    subtitle="Faculty Consultation Assistant"
    welcome="Hi! I can guide you through Faculty features and summarize your consultation schedules and appointment activity."
    suggestions={["Do I have an ongoing consultation?", "What's my next appointment?", "How many pending requests do I have?", "How do I add consultation availability?"]}
    placeholder="Ask about your consultation activity..."
    loadingLabel="Checking your consultation activity..."
    disclaimer="Read-only guidance and information for your authenticated Faculty account."
    launcherMonogram="F"
  />;
}
