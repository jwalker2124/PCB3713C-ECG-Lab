import ModulePage from '../../components/ModulePage'

export default function PhysicsFoundations() {
  return (
    <ModulePage
      moduleId="physics"
      number={1}
      title="Physics foundations"
      objective="An EKG does not directly record the heart's electrical signal. It records the projection of the net cardiac dipole vector onto a lead axis — a geometric operation you already know from Physics 2."
      description="This module rebuilds the bridge between Physics 2 and cardiology. You will interactively explore how point charges create electric fields, how a dipole emerges from charge separation, what voltage actually measures between two points, and how projecting a moving vector onto different axes produces different waveform amplitudes. By the end, Einthoven's Triangle will feel like a natural consequence of vector projection — not a memorized fact."
    />
  )
}
