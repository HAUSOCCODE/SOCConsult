import SOCConsultAIAssistant from "../admin/SOCConsultAIAssistant";

export default function SOCConsultStudentAIAssistant() {
  return <SOCConsultAIAssistant
    endpoint="/student/ai/chat"
    title="SOCConsult Student AI"
    subtitle="Student Consultation Assistant"
    welcome="Hi! I can guide you through using SOCConsult and help summarize your consultation information."
    suggestions={["How do I book a consultation?", "When is my next consultation?", "Do I have appointments that need rescheduling?", "How do I upload supporting documents?"]}
    placeholder="Ask about your consultations..."
    loadingLabel="Checking your consultation information..."
    disclaimer="Read-only guidance and information for your authenticated Student account."
    launcherMonogram="S"
  />;
}
