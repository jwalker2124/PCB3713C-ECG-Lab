import ModulePage from '../../components/ModulePage'

export default function PatientScenarios() {
  return (
    <ModulePage
      moduleId="scenarios"
      number={4}
      title="Patient scenarios"
      objective="The full diagnostic chain runs: this wave changed → this structure failed → this is what the patient feels. Patient Scenarios trains you to run that chain fluently in both directions — from EKG to diagnosis and from presentation to mechanism."
      description="Each case presents a brief clinical vignette — age, chief complaint, relevant history, vital signs — followed by an EKG strip. Your task is to identify the rhythm, locate the physiological problem, and connect it to the patient's presentation. The first case is scaffolded with guided prompts. Subsequent cases offer no hints. Your performance is tracked so you can see which rhythm categories you master and which need more work."
    />
  )
}
