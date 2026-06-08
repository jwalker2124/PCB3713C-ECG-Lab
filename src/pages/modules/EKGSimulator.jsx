import ModulePage from '../../components/ModulePage'

export default function EKGSimulator() {
  return (
    <ModulePage
      moduleId="ekg"
      number={3}
      title="EKG simulator & rhythm library"
      objective="Cardiac arrhythmias are not mysterious patterns to memorize — they are predictable consequences of specific failures in the conduction system. If you know which structure failed, you can derive what the EKG must look like."
      description="This module brings everything together in a three-panel live simulation: an animated heart showing the conduction wavefront, a rotating cardiac vector in Einthoven's Triangle, and a continuously scrolling EKG strip. Select from 12 physiologically accurate rhythms, adjust parameters in real time, and switch between limb leads to see how each perspective changes the trace. Each rhythm includes an instructional explanation grounded in the physiology from Module 2."
    />
  )
}
