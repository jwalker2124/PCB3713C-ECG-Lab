import ModulePage from '../../components/ModulePage'

export default function CardiacBridge() {
  return (
    <ModulePage
      moduleId="cardiac"
      number={2}
      title="Cardiac electrophysiology"
      objective="Every wave in an EKG corresponds to depolarization or repolarization of a specific anatomical structure. When that structure fails, the wave changes in a predictable way you can reason through — not just recognize."
      description="This module walks through the heart's electrical system from first principles. Watch the SA node fire, depolarization spread through the atria, slow at the AV node (and understand precisely why that delay exists and what happens when it fails), accelerate through the His-Purkinje system, and sweep through the ventricular myocardium. Each anatomical stage maps directly to a feature of the EKG trace, and the cardiac vector model from Module 1 connects them both."
    />
  )
}
