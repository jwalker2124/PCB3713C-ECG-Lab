import { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import p5 from 'p5'
import ModulePage from '../../components/ModulePage'
import HeartAnimation, { buildConductionMap } from '../../components/HeartAnimation'
import { ECGVoltage, buildRhythmFromParams } from '../../lib/ECGEngine'

// ── Constants ──────────────────────────────────────────────────────────────
const CYCLE_MS = 800
const DEFAULT_RHYTHM_PARAMS = {
  saNodeRate: 75, avConductionRatio: 'all', prInterval: 160,
  qrsDuration: 80, qtInterval: 380, pWaveMode: 'present', escapeRhythm: 'none',
}

// ── Anatomy data ───────────────────────────────────────────────────────────
const ANATOMY = {
  sa: {
    name: 'SA Node (Sinoatrial Node)',
    apType: 'sa',
    fn: 'Primary pacemaker — spontaneously depolarizes 60–100 times per minute without external stimulus. Located at the junction of the superior vena cava and the right atrium.',
    electrical: 'Fires via If (HCN "funny" channels) + ICa-T during Phase 4 pacemaker potential. No stable resting potential. Upstroke driven by ICa-L (not fast INa), producing a slow, rounded action potential. Slope of Phase 4 determines heart rate.',
    ECG: 'Not directly visible on surface ECG. Its firing initiates the P wave, but the SA node signal is too small. Dysfunction manifests as sinus bradycardia, sick sinus syndrome, or sinus arrest.',
  },
  ra: {
    name: 'Right Atrium',
    apType: 'myocyte',
    fn: 'Receives deoxygenated blood from the superior and inferior vena cava and coronary sinus. Contracts to complete ventricular filling (atrial kick).',
    electrical: 'Fast-response myocyte with prominent Phase 0 INa upstroke. Conduction from SA node spreads at ~1 m/s. Refractory period shorter than ventricles, enabling rapid atrial rhythms.',
    ECG: 'Initial (first half) of the P wave. Right atrial enlargement prolongs or widens the early P wave. Depolarizes slightly before left atrium.',
  },
  la: {
    name: 'Left Atrium',
    apType: 'myocyte',
    fn: 'Receives oxygenated blood from four pulmonary veins. Contracts to complete left ventricular filling. Forms the posterior heart border on chest X-ray.',
    electrical: "Connected to RA via Bachmann's bundle (interatrial conduction pathway). Conduction velocity ~1 m/s. Activates slightly later than RA due to path length.",
    ECG: "Terminal (second half) of the P wave. Left atrial enlargement produces a bifid P wave (P mitrale) in lead II or negative terminal deflection in V1.",
  },
  av: {
    name: 'AV Node (Atrioventricular Node)',
    apType: 'sa',
    fn: 'The only normal electrical bridge between atria and ventricles (AV annulus is otherwise electrically insulating). Imposes a 120–200 ms delay — critical for allowing ventricular filling before systole.',
    electrical: 'Slow-response cells like SA node: upstroke via ICa-L, no fast INa. Conduction velocity only 0.05 m/s — the slowest in the heart. Heavily innervated by both vagal (slows) and sympathetic (accelerates) fibers. Site of most Wenckebach and complete heart block.',
    ECG: 'Responsible for the PR interval. AV nodal delay = isoelectric PR segment. First-degree block = PR > 200 ms. Third-degree block = complete dissociation of P waves and QRS complexes.',
  },
  his: {
    name: 'Bundle of His',
    apType: 'purkinje',
    fn: 'Exits the AV node and penetrates the fibrous skeleton of the heart, dividing into left and right bundle branches. Rapid conduction ensures synchronous ventricular activation.',
    electrical: 'Purkinje-type: fast INa upstroke, very rapid conduction (1–2 m/s), long plateau phase. His bundle recording (catheter lab) confirms whether block is above or below the bundle.',
    ECG: 'Not directly visible. Conduction through His-Purkinje system forms the early part of the QRS complex. His-Purkinje disease → wide QRS, bundle branch blocks.',
  },
  rbundle: {
    name: 'Right Bundle Branch',
    apType: 'purkinje',
    fn: 'Carries depolarization to the right ventricular myocardium and interventricular septum (right side). Travels subendocardially along the right side of the septum.',
    electrical: 'Purkinje fiber type. Conduction 2–4 m/s. Terminates in Purkinje network. Right bundle branch is thinner and more susceptible to block than left.',
    ECG: 'Block → RBBB pattern: wide QRS (≥120 ms), rSR′ in V1 (right-ear rabbit pattern), wide S in lateral leads (I, V5, V6). Incomplete RBBB = 100–119 ms.',
  },
  lbundle: {
    name: 'Left Bundle Branch',
    apType: 'purkinje',
    fn: 'Carries depolarization to the left ventricular myocardium and septum (left side). Fans into anterior and posterior fascicles.',
    electrical: 'Purkinje fiber type. Conduction 2–4 m/s. Left bundle has two fascicles — anterior (LAD artery supply) and posterior (dual supply, more resistant to block).',
    ECG: 'Block → LBBB: wide QRS, broad notched R in lateral leads, QS in V1. Left anterior fascicular block → left axis deviation. Left posterior fascicular block → right axis deviation.',
  },
  purkinje: {
    name: 'Purkinje Fibers',
    apType: 'purkinje',
    fn: 'Terminal conduction network fanning from bundle branches into ventricular myocardium. Ensures nearly simultaneous endocardial activation across both ventricles.',
    electrical: 'Fastest conduction in heart (2–4 m/s). Longest action potential duration. Longest Phase 2 plateau. Tertiary pacemaker (20–40 bpm) if SA and AV nodes fail — escape rhythm. Susceptible to triggered activity (EADs, DADs).',
    ECG: 'No discrete surface ECG representation. Their rapid activation underlies the narrow normal QRS (< 100 ms). Block in Purkinje fan → slow myocardial spread → wide, aberrant QRS.',
  },
  rv: {
    name: 'Right Ventricle',
    apType: 'myocyte',
    fn: 'Pumps deoxygenated blood into the pulmonary circulation via the pulmonary artery at low pressure (~25 mmHg systolic). Thin-walled, crescent-shaped in cross-section.',
    electrical: 'Activated by right bundle branch via Purkinje network, endocardium to epicardium. Myocyte action potential (Phases 0–4). Thinner wall means smaller contribution to QRS than LV.',
    ECG: 'Right ventricular hypertrophy → right axis deviation, dominant R in V1 (R > S). RV infarction (often with inferior STEMI) → ST elevation in V3R–V4R.',
  },
  lv: {
    name: 'Left Ventricle',
    apType: 'myocyte',
    fn: 'Pumps oxygenated blood into the systemic circulation at high pressure (~120 mmHg systolic). Thick-walled (~1 cm), ellipsoid. Generates the largest electrical forces in the heart.',
    electrical: 'Activated by left bundle branch, endocardium to epicardium. Myocyte action potential. LV mass dominates QRS vector — explains why normal axis points leftward and inferiorly (toward LV).',
    ECG: 'LV hypertrophy → increased R in V5/V6 + deep S in V1/V2 (Sokolow-Lyon). Dominant contributor to QRS amplitude. Lateral STEMI = LV territory (LAD / circumflex).',
  },
  septum: {
    name: 'Interventricular Septum',
    apType: 'myocyte',
    fn: 'Muscular wall separating right and left ventricles. Depolarizes from left-to-right first, creating the initial septal q waves in lateral leads. Shares mechanical load with both ventricles.',
    electrical: 'Left-to-right initial depolarization (LBB activates septum first). This produces small q waves in I, aVL, V5, V6 — normal narrow septal q waves. In LBBB, septum depolarizes right-to-left, eliminating normal septal q.',
    ECG: 'Septal q waves (narrow < 40 ms) in lateral leads are normal. Loss of septal q in lateral leads suggests LBBB. Septal hypertrophy in HCM → dynamic LVOT obstruction, asymmetric septal thickening.',
  },
}

// ── AP waveform arrays ─────────────────────────────────────────────────────
const SA_AP = [
  [0.00,-62],[0.08,-61],[0.16,-60],[0.24,-58],[0.32,-56],
  [0.40,-53],[0.48,-50],[0.56,-47],[0.63,-44],[0.68,-40],
  [0.72,-22],[0.74,-4],[0.76,10],[0.77,16],
  [0.79,13],[0.82,5],[0.86,-12],[0.90,-36],[0.94,-55],[0.97,-61],[1.00,-62],
]
const MYO_AP = [
  [0.00,-90],[0.05,-90],[0.10,-90],[0.15,-90],[0.18,-90],
  [0.182,-88],[0.187,-55],[0.192,5],[0.197,28],[0.202,30],
  [0.207,24],[0.216,12],
  [0.225,9],[0.280,7],[0.340,5],[0.400,3],[0.460,1],[0.475,0],
  [0.490,-8],[0.508,-25],[0.525,-55],[0.542,-80],[0.558,-89],[0.575,-90],
  [0.62,-90],[0.72,-90],[0.82,-90],[0.92,-90],[1.00,-90],
]
const PK_AP = [
  [0.00,-92],[0.05,-92],[0.10,-91],[0.16,-91],[0.18,-90],
  [0.182,-88],[0.185,-48],[0.188,12],[0.192,34],[0.198,38],
  [0.203,30],[0.215,15],
  [0.225,12],[0.280,10],[0.340,8],[0.400,5],[0.460,3],[0.520,1],[0.540,0],
  [0.558,-8],[0.578,-26],[0.605,-60],[0.635,-82],[0.665,-91],[0.690,-92],
  [0.73,-92],[0.80,-92],[0.87,-91],[0.94,-91],[1.00,-92],
]

// ── Phase ion-channel data ─────────────────────────────────────────────────
const SA_PHASES = [
  {
    id: 'p4', label: 'Phase 4 — Pacemaker Potential', tRange: [0, 0.68],
    channels: 'If (HCN channels) + ICa-T',
    ions: 'Na⁺ and K⁺ slowly IN via If ("funny" current); Ca²⁺ via T-type channels → gradual depolarization −62→−40 mV. No stable resting potential. Slope of this ramp sets heart rate. Sympathetic ↑ slope (faster); vagal ↓ slope (slower).',
  },
  {
    id: 'p0', label: 'Upstroke (ICa-L driven)', tRange: [0.68, 0.78],
    channels: 'ICa-L — NO fast INa',
    ions: 'Ca²⁺ in via L-type channels → slow, rounded upstroke to ~+16 mV. Much slower than ventricular upstroke (no INa). This makes SA node conduction inherently slow.',
  },
  {
    id: 'repol', label: 'Repolarization', tRange: [0.78, 1.0],
    channels: 'IK (delayed rectifier) + IK-ACh',
    ions: 'K⁺ exits via delayed rectifiers and acetylcholine-gated channels. Membrane returns to −62 mV to begin next pacemaker cycle. IK-ACh allows vagal nerve to hyperpolarize and slow pacemaking.',
  },
]
const MYO_PHASES = [
  {
    id: 'p4r', label: 'Phase 4 — Resting Potential', tRange: [0, 0.182],
    channels: 'IK1 (inward rectifier)',
    ions: 'K⁺ outward via IK1 → stable resting potential of −90 mV. Stable until external depolarization (from Purkinje fibers or adjacent myocytes).',
  },
  {
    id: 'p0', label: 'Phase 0 — Fast Upstroke', tRange: [0.182, 0.207],
    channels: 'INa (fast voltage-gated Na⁺)',
    ions: 'Na⁺ rushes in through fast channels → −90→+30 mV in ~1–2 ms. Largest and fastest current. Threshold ~−65 mV. Rate of rise (dV/dt max) determines conduction velocity.',
  },
  {
    id: 'p1', label: 'Phase 1 — Early Repolarization', tRange: [0.207, 0.225],
    channels: 'Ito (transient outward K⁺)',
    ions: 'K⁺ briefly exits via Ito → creates "notch" between upstroke and plateau. More prominent in epicardium than endocardium → transmural voltage gradient contributes to T wave polarity.',
  },
  {
    id: 'p2', label: 'Phase 2 — Plateau', tRange: [0.225, 0.480],
    channels: 'ICa-L (in) balanced vs IKr + IKs (out)',
    ions: 'Ca²⁺ in BALANCED by K⁺ out → plateau ~0–10 mV for ~200 ms. Ca²⁺ influx triggers Ca²⁺-induced Ca²⁺ release (CICR) from SR → contraction. Plateau prevents re-excitation (refractory period = mechanical protection).',
  },
  {
    id: 'p3', label: 'Phase 3 — Rapid Repolarization', tRange: [0.480, 0.580],
    channels: 'IKr + IKs (rapid + slow delayed rectifiers)',
    ions: 'ICa-L inactivates; IKr/IKs dominate → K⁺ exits rapidly → rapid return to −90 mV. IKr is the hERG channel — target of many drugs causing QT prolongation (torsades risk).',
  },
  {
    id: 'p4d', label: 'Phase 4 — Electrical Diastole', tRange: [0.580, 1.0],
    channels: 'IK1 (inward rectifier)',
    ions: 'IK1 maintains stable −90 mV. No spontaneous depolarization (unlike SA node) — requires external stimulus to fire again.',
  },
]
const PK_PHASES = [
  {
    id: 'p4r', label: 'Phase 4 — Resting / Pacemaker', tRange: [0, 0.182],
    channels: 'IK1 + slow If',
    ions: 'Normally IK1 holds −92 mV. If SA/AV fail, slow If activates → spontaneous depolarization at 20–40 bpm (escape rhythm). Most negative resting potential in heart.',
  },
  {
    id: 'p0', label: 'Phase 0 — Fastest Upstroke', tRange: [0.182, 0.203],
    channels: 'INa (fast) — highest dV/dt in heart',
    ions: 'Na⁺ rushes in → fastest dV/dt of any cardiac cell (~900 V/s). −92→+38 mV. Enables extremely fast conduction (2–4 m/s) to activate ventricles nearly simultaneously.',
  },
  {
    id: 'p1', label: 'Phase 1 — Early Repolarization', tRange: [0.203, 0.225],
    channels: 'Ito',
    ions: 'K⁺ briefly exits via transient outward → notch. Similar to myocyte but slightly more pronounced.',
  },
  {
    id: 'p2', label: 'Phase 2 — Longest Plateau', tRange: [0.225, 0.540],
    channels: 'ICa-L vs IKr + IKs',
    ions: 'Longest plateau of any cardiac cell (~300 ms). ICa-L in balanced by K⁺ out. Extended refractory period → protects against rapid ventricular rates. EADs and DADs most common here.',
  },
  {
    id: 'p3', label: 'Phase 3 — Rapid Repolarization', tRange: [0.540, 0.690],
    channels: 'IKr + IKs dominant',
    ions: 'Rapid return to −92 mV as IKr/IKs dominate. Longest AP duration → last to repolarize → determines QT interval in part.',
  },
  {
    id: 'p4d', label: 'Phase 4 — Electrical Diastole', tRange: [0.690, 1.0],
    channels: 'IK1 (± slow If)',
    ions: 'IK1 stabilizes at −92 mV. Latent automaticity: slow If may gradually depolarize if dominant pacemakers fail. Site of DAD-triggered arrhythmias (digitalis toxicity, Ca²⁺ overload).',
  },
]

// ── Structure lookup tables (for 2C) ──────────────────────────────────────
const STRUCT_NAMES = {
  sa: 'SA Node', ra: 'Right Atrium', la: 'Left Atrium',
  bachmann: "Bachmann's Bundle", av: 'AV Node',
  his: 'Bundle of His', rbundle: 'Right Bundle Branch', lbundle: 'Left Bundle Branch',
  rv: 'Right Ventricle', lv: 'Left Ventricle', apex: 'Apex / Purkinje Fan',
  repolLV: 'LV Repolarization', repolRV: 'RV Repolarization',
}
const STRUCT_CV = {
  sa: '—', bachmann: '1.0 m/s', ra: '1.0 m/s', la: '1.0 m/s',
  av: '0.05 m/s', his: '1.0 m/s', rbundle: '2–4 m/s', lbundle: '2–4 m/s',
  rv: '0.3–0.5 m/s', lv: '0.3–0.5 m/s', apex: '0.3–0.5 m/s',
  repolLV: '—', repolRV: '—',
}
const STRUCT_NOTE = {
  sa: 'SA node fires spontaneously via If (HCN channels). Rate governed by slope of Phase 4 pacemaker potential. Not visible on surface ECG directly.',
  ra: 'Atrial myocardium conducting at ~1 m/s. Right atrium activates first → initial P wave.',
  la: "Left atrium activates via Bachmann's bundle. Terminal P wave. Enlargement → P mitrale.",
  bachmann: "Interatrial conduction pathway connecting RA to LA at ~1 m/s. Failure → ectopic atrial rhythms.",
  av: 'AV node delay (0.05 m/s) = PR segment on ECG. Critical for ventricular filling before systole.',
  his: 'Bundle of His conducts at ~1 m/s — transitional speed before Purkinje acceleration.',
  rbundle: 'Rapid Purkinje conduction to RV endocardium (2–4 m/s). Block → RBBB pattern.',
  lbundle: 'Rapid Purkinje conduction to LV endocardium and septum (2–4 m/s). Block → LBBB pattern.',
  rv: 'RV myocardium activates endocardium → epicardium at 0.3–0.5 m/s. Thin wall, lower contribution to QRS.',
  lv: 'LV myocardium dominates QRS. Thick wall activation endocardium → epicardium. Lateral + inferior forces.',
  apex: 'Purkinje fan delivers nearly simultaneous endocardial activation across ventricular apex.',
  repolLV: 'Ventricular repolarization (T wave). Travels epicardium → endocardium (opposite to depolarization) → same T wave polarity as QRS in most leads.',
  repolRV: 'RV repolarization contributes to early T wave. Smaller contribution than LV.',
}

// ── 2C Depolarization sequence — heart geometry + stage data ──────────────
// Scale + offset mapping HeartAnimation SVG viewBox (0 0 200 260) → canvas px
const _HS = 1.35, _HOX = 20, _HOY = 10
const _hx = x => _HOX + x * _HS
const _hy = y => _HOY + y * _HS

// Exterior anterior-oblique view of the heart (matches Boron & Boulpaep reference image)
function _pOutline(ctx) {
  ctx.beginPath()
  ctx.moveTo(_hx(65), _hy(38))
  ctx.bezierCurveTo(_hx(68),_hy(18), _hx(88),_hy(8),  _hx(108),_hy(8))
  ctx.bezierCurveTo(_hx(132),_hy(8), _hx(155),_hy(24), _hx(165),_hy(46))
  ctx.bezierCurveTo(_hx(172),_hy(62), _hx(170),_hy(84), _hx(160),_hy(100))
  ctx.bezierCurveTo(_hx(162),_hy(118), _hx(162),_hy(150), _hx(156),_hy(178))
  ctx.bezierCurveTo(_hx(148),_hy(210), _hx(128),_hy(234), _hx(106),_hy(248))
  ctx.bezierCurveTo(_hx(96),_hy(254), _hx(80),_hy(254), _hx(70),_hy(248))
  ctx.bezierCurveTo(_hx(50),_hy(238), _hx(32),_hy(214), _hx(22),_hy(184))
  ctx.bezierCurveTo(_hx(14),_hy(157), _hx(18),_hy(124), _hx(28),_hy(100))
  ctx.bezierCurveTo(_hx(36),_hy(78),  _hx(48),_hy(58),  _hx(58),_hy(44))
  ctx.bezierCurveTo(_hx(60),_hy(38),  _hx(62),_hy(36),  _hx(65),_hy(38))
  ctx.closePath()
}
function _pAtriaRegion(ctx) {
  ctx.beginPath()
  ctx.moveTo(_hx(28), _hy(100))
  ctx.bezierCurveTo(_hx(36),_hy(78),  _hx(48),_hy(58),  _hx(58),_hy(44))
  ctx.bezierCurveTo(_hx(62),_hy(38),  _hx(66),_hy(30),  _hx(68),_hy(20))
  ctx.bezierCurveTo(_hx(80),_hy(6),   _hx(96),_hy(8),   _hx(108),_hy(8))
  ctx.bezierCurveTo(_hx(132),_hy(8),  _hx(155),_hy(24), _hx(165),_hy(46))
  ctx.bezierCurveTo(_hx(172),_hy(62), _hx(170),_hy(84), _hx(160),_hy(100))
  ctx.lineTo(_hx(28), _hy(100))
  ctx.closePath()
}
function _pVentricleMass(ctx) {
  ctx.beginPath()
  ctx.moveTo(_hx(28), _hy(100))
  ctx.lineTo(_hx(160), _hy(100))
  ctx.bezierCurveTo(_hx(162),_hy(118), _hx(162),_hy(150), _hx(156),_hy(178))
  ctx.bezierCurveTo(_hx(148),_hy(210), _hx(128),_hy(234), _hx(106),_hy(248))
  ctx.bezierCurveTo(_hx(96),_hy(254),  _hx(80),_hy(254),  _hx(70),_hy(248))
  ctx.bezierCurveTo(_hx(50),_hy(238),  _hx(32),_hy(214),  _hx(22),_hy(184))
  ctx.bezierCurveTo(_hx(14),_hy(157),  _hx(18),_hy(124),  _hx(28),_hy(100))
  ctx.closePath()
}
const _RPATHS = { atria: _pAtriaRegion, ventr: _pVentricleMass }
// Ventricular fill geometry constants
const _VCX  = _hx(92)              // center x of ventricular mass (septum)
const _VTY  = _hy(100)             // top of ventricle (AV groove level)
const _VBY  = _hy(254)             // bottom (apex)
const _VH   = _VBY - _VTY
const _VSEP = _hx(108) - _hx(92)  // septum half-width in px (~21.6px)
const _VMAX = _hx(162) - _hx(92)  // max right half-width in px (~94.5px)
const _ACLIP = { x:_hx(28), y:_hy(8), w:_hx(165)-_hx(28), fullH:_hy(100)-_hy(8) }

const DEPOLSEQ_STAGES = [
  { id:1, stageNum:'1 of 6', ecgPart:'P',  color:[59,130,246],  start:0,   end:80,
    label:'Depolarize atria',
    note:"SA node fires → both atria depolarize simultaneously via Bachmann's bundle. AV annulus is electrically insulated — impulse funnels exclusively into AV node." },
  { id:2, stageNum:'2 of 6', ecgPart:'Q',  color:[139,92,246],  start:180, end:200,
    label:'Depolarize septum — left to right',
    note:'Left bundle branch activates the LV endocardial face of the septum first. Initial vector points toward RV (rightward) → produces the narrow Q wave in lateral leads (I, V5–V6).' },
  { id:3, stageNum:'3 of 6', ecgPart:'R↑', color:[139,92,246],  start:200, end:220,
    label:'Anteroseptal region toward the apex',
    note:'Purkinje system delivers depolarization apically at 2–4 m/s. Nearly simultaneous endocardial activation from apex upward. Main QRS deflection begins.' },
  { id:4, stageNum:'4 of 6', ecgPart:'R',  color:[139,92,246],  start:220, end:240,
    label:'Bulk ventricular myocardium (endo → epi)',
    note:'Dominant LV mass activates endocardium → epicardium at 0.3–0.5 m/s. Net vector points LEFT and INFERIOR — R wave in leads I, II, V4–V6. Normal QRS axis ≈ +60°.' },
  { id:5, stageNum:'5 of 6', ecgPart:'S',  color:[139,92,246],  start:240, end:260,
    label:'Posterior base of left ventricle',
    note:'Last myocardium to depolarize: posterior-basal LV (circumflex territory from Module 2A). Late vector points SUPERIOR/POSTERIOR → S wave in lateral leads.' },
  { id:6, stageNum:'6 of 6', ecgPart:'ST', color:[52,211,153],  start:260, end:380,
    label:'Ventricles fully depolarized (ST segment)',
    note:'All myocardium in plateau phase — no net dipole, isoelectric baseline. Ischemic injury current (STEMI/NSTEMI) disrupts this equilibrium, shifting the ST segment.' },
  { id:7, stageNum:'Repol',  ecgPart:'T',  color:[245,158,11],  start:380, end:540,
    label:'Repolarization — base to apex (T wave)',
    note:'Epicardial cells (prominent Ito) have shorter action potentials → repolarize before endocardial cells. Repolarization direction = same as QRS net vector → T wave is UPRIGHT in leads with tall R.' },
]

function _getDepolStage(tMs) {
  if (tMs >= 80 && tMs < 180) return { id:'av', stageNum:'AV delay', ecgPart:'PR', color:[100,120,140], start:80, end:180,
    label:'AV nodal delay — PR segment',
    note:'Conduction slows to 0.05 m/s in the AV node — the slowest in the heart. This 100 ms pause allows ventricular filling before systole. PR segment is isoelectric.',
    progress:(tMs-80)/100 }
  if (tMs >= 540) return { id:'diastole', stageNum:'Diastole', ecgPart:'—', color:[55,65,80], start:540, end:800,
    label:'Electrical diastole',
    note:'Myocardium at −90 mV (IK1). SA node pacemaker potential building via If (HCN channels) toward next threshold.',
    progress:(tMs-540)/260 }
  for (const s of DEPOLSEQ_STAGES)
    if (tMs >= s.start && tMs < s.end) return { ...s, progress:(tMs-s.start)/(s.end-s.start) }
  return null
}

function _getDepolFills(tMs) {
  const cl = v => Math.max(0, Math.min(1, v))
  return {
    atria:   cl(tMs/80),                           // stage 1: both atria
    septum:  tMs<180 ? 0 : cl((tMs-180)/20),       // stage 2: septal band appears top-down
    apex:    tMs<200 ? 0 : cl((tMs-200)/20),       // stage 3: apex extension bottom-up
    lateral: tMs<220 ? 0 : cl((tMs-220)/40),       // stage 4: lateral walls expand outward
    repolA:  tMs<540 ? 0 : cl((tMs-540)/100),
    repolV:  tMs<380 ? 0 : cl((tMs-380)/160),
  }
}

const _DEPOLHOVER = {
  atria: { name:'Atria (RA + LA)', cv:'1.0 m/s',     note:'SA node fires → bilateral atrial depolarization via Bachmann\'s bundle' },
  ventr: { name:'Ventricles (LV + RV)', cv:'0.3–0.5 m/s', note:'Purkinje network → endocardium-to-epicardium spread. LV mass dominates QRS.' },
}
const _ECG_REGIONS = [
  { label:'P',   from:0.030, to:0.100, stages:[1],         color:[59,130,246]  },
  { label:'PR',  from:0.100, to:0.225, stages:['av'],       color:[100,120,140] },
  { label:'QRS', from:0.225, to:0.300, stages:[2,3,4,5],   color:[139,92,246]  },
  { label:'ST',  from:0.300, to:0.475, stages:[6],          color:[52,211,153]  },
  { label:'T',   from:0.475, to:0.670, stages:[7],          color:[245,158,11]  },
]

// ── DepolarizationSequence canvas component ────────────────────────────────
function DepolarizationSequence({ masterTimeMs, cycleMs, waves, onScrub, isPlaying, onToggle, speedMult, onSpeedChange }) {
  const containerRef = useRef()
  const p5Ref        = useRef(null)
  const dataRef      = useRef({ masterTimeMs, cycleMs, waves })
  const [tooltip, setTooltip]     = useState(null)
  const [tipPos,  setTipPos]      = useState({ x:0, y:0 })

  useEffect(() => { dataRef.current = { masterTimeMs, cycleMs, waves }; p5Ref.current?.redraw() }, [masterTimeMs, cycleMs, waves])

  const handleMouseMove = useCallback((e) => {
    const canvas = containerRef.current?.querySelector('canvas')
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const mx = (e.clientX - rect.left) * (canvas.width / rect.width)
    const my = (e.clientY - rect.top)  * (canvas.height / rect.height)
    const ctx = canvas.getContext('2d')
    for (const [id, fn] of Object.entries(_RPATHS)) {
      fn(ctx)
      if (ctx.isPointInPath(mx, my)) {
        setTooltip(_DEPOLHOVER[id])
        setTipPos({ x: e.clientX - rect.left, y: e.clientY - rect.top })
        return
      }
    }
    setTooltip(null)
  }, [])
  const handleMouseLeave = useCallback(() => setTooltip(null), [])

  useEffect(() => {
    const W = 640, H = 415
    const PNL_X = 336   // right info-panel start
    const ECG_Y = 350, ECG_H = 56
    const DV_CX = PNL_X + (W - PNL_X) / 2, DV_CY = ECG_Y - 85, DV_R = 56

    function arrow(ctx, x1, y1, x2, y2, col = '#8B0000', lw = 2.5) {
      const a = Math.atan2(y2-y1, x2-x1), hl = 9
      ctx.save(); ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = lw; ctx.lineCap = 'round'
      ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(x2,y2)
      ctx.lineTo(x2-hl*Math.cos(a-0.4), y2-hl*Math.sin(a-0.4))
      ctx.lineTo(x2-hl*Math.cos(a+0.4), y2-hl*Math.sin(a+0.4))
      ctx.closePath(); ctx.fill(); ctx.restore()
    }
    function curvedArrow(ctx, x1, y1, cpx, cpy, x2, y2, col = '#8B0000') {
      const a = Math.atan2(y2-cpy, x2-cpx), hl = 9
      ctx.save(); ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 2.5; ctx.lineCap = 'round'
      ctx.beginPath(); ctx.moveTo(x1,y1); ctx.quadraticCurveTo(cpx,cpy,x2,y2); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(x2,y2)
      ctx.lineTo(x2-hl*Math.cos(a-0.4), y2-hl*Math.sin(a-0.4))
      ctx.lineTo(x2-hl*Math.cos(a+0.4), y2-hl*Math.sin(a+0.4))
      ctx.closePath(); ctx.fill(); ctx.restore()
    }
    function rrect(ctx, x, y, w, h, r, fill, stroke) {
      ctx.beginPath()
      ctx.moveTo(x+r,y); ctx.lineTo(x+w-r,y); ctx.arcTo(x+w,y,x+w,y+r,r)
      ctx.lineTo(x+w,y+h-r); ctx.arcTo(x+w,y+h,x+w-r,y+h,r)
      ctx.lineTo(x+r,y+h); ctx.arcTo(x,y+h,x,y+h-r,r)
      ctx.lineTo(x,y+r); ctx.arcTo(x,y,x+r,y,r); ctx.closePath()
      if (fill)  { ctx.fillStyle   = fill;   ctx.fill()   }
      if (stroke){ ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke() }
    }
    function fillRegion(ctx, pathFn, cr, dp, rp) {
      ctx.save(); pathFn(ctx); ctx.fillStyle='#252e42'; ctx.fill()
      ctx.strokeStyle='#36455a'; ctx.lineWidth=1.2; ctx.stroke(); ctx.restore()
      if (dp > 0.005) {
        const h = cr.fullH * Math.min(1, dp)
        ctx.save(); pathFn(ctx); ctx.clip()
        ctx.fillStyle='#F5C518'; ctx.globalAlpha=Math.min(1, 0.5+dp*0.5)
        ctx.fillRect(cr.x, cr.y, cr.w, h); ctx.globalAlpha=1; ctx.restore()
      }
      if (rp > 0.005) {
        const h = cr.fullH * Math.min(1, rp)
        ctx.save(); pathFn(ctx); ctx.clip()
        ctx.fillStyle='#87CEEB'; ctx.globalAlpha=Math.min(1, 0.4+rp*0.6)
        ctx.fillRect(cr.x, cr.y+cr.fullH-h, cr.w, h); ctx.globalAlpha=1; ctx.restore()
      }
    }
    function wrapText(ctx, text, x, y, maxW, lineH) {
      const words = text.split(' '); let line = ''
      for (const word of words) {
        const test = line + (line?' ':'') + word
        if (ctx.measureText(test).width > maxW && line) { ctx.fillText(line,x,y); y+=lineH; line=word }
        else line=test
      }
      if (line) ctx.fillText(line,x,y)
    }

    const sketch = (p) => {
      let ecgCache = null
      function buildCache(w, cm) {
        if (!w||!cm) return []
        return Array.from({length:500},(_,i) => ECGVoltage((i/500)*cm, cm, w, 60))
      }

      p.setup = () => { p.createCanvas(W, H); p.noLoop() }

      p.draw = () => {
        const { masterTimeMs:tMs, cycleMs:cm, waves:w } = dataRef.current
        const ctx = p.drawingContext
        const stage  = _getDepolStage(tMs)
        const fills  = _getDepolFills(tMs)
        const DARK   = '#8B0000', BLUE = '#87CEEB'

        p.background(13, 17, 30)

        // Right panel background
        rrect(ctx, PNL_X-2, 4, W-PNL_X-2, H-8, 8, '#0f1726', '#1b2d42')

        // ── Exterior-view heart (Boron & Boulpaep reference style) ──
        const GRAY='#888888', YEL='#F5C518', BLEU='#87CEEB'
        const vColor = fills.repolV > 0.01 ? BLEU : YEL
        const aColor = fills.repolA > 0.01 ? BLEU : YEL

        // 1. Black silhouette — creates thick epicardial border effect
        ctx.save(); _pOutline(ctx); ctx.fillStyle='#000'; ctx.fill(); ctx.restore()

        // 2. Gray base fills (resting myocardium)
        ctx.save(); _pAtriaRegion(ctx);   ctx.fillStyle=GRAY; ctx.fill(); ctx.restore()
        ctx.save(); _pVentricleMass(ctx); ctx.fillStyle=GRAY; ctx.fill(); ctx.restore()

        // 3. Great vessel stubs (pulmonary trunk + aorta) — gray with thick black border
        ctx.save()
        ctx.fillStyle=GRAY; ctx.strokeStyle='#000'; ctx.lineWidth=4; ctx.lineJoin='round'
        // Pulmonary trunk (upper-left of base)
        ctx.beginPath()
        ctx.moveTo(_hx(55),_hy(38)); ctx.lineTo(_hx(55),_hy(2))
        ctx.lineTo(_hx(78),_hy(2)); ctx.lineTo(_hx(78),_hy(28))
        ctx.fill(); ctx.stroke()
        // Aorta (upper-right of base, slightly taller)
        ctx.beginPath()
        ctx.moveTo(_hx(108),_hy(18)); ctx.lineTo(_hx(108),_hy(0))
        ctx.lineTo(_hx(130),_hy(0)); ctx.lineTo(_hx(130),_hy(12))
        ctx.fill(); ctx.stroke()
        // Labels
        ctx.fillStyle='#9ca3af'; ctx.font='7px sans-serif'; ctx.textAlign='center'
        ctx.fillText('PA',  _hx(66.5),_hy(-4))
        ctx.fillText('Ao',  _hx(119),  _hy(-4))
        ctx.restore()

        // 4. Atrial fill: top-down sweep (stage 1)
        if (fills.atria > 0.004) {
          const ah = _ACLIP.fullH * Math.min(1, fills.atria)
          ctx.save(); _pAtriaRegion(ctx); ctx.clip()
          ctx.fillStyle=aColor; ctx.fillRect(_ACLIP.x, _ACLIP.y, _ACLIP.w, ah)
          ctx.restore()
        }

        // 5. Ventricular fills — septal band → apex extension → lateral spread
        // Stage 2: narrow septal band, top-down
        if (fills.septum > 0.004) {
          const sh = _VH * Math.min(1, fills.septum)
          ctx.save(); _pVentricleMass(ctx); ctx.clip()
          ctx.fillStyle=vColor; ctx.fillRect(_VCX-_VSEP, _VTY, _VSEP*2, sh)
          ctx.restore()
        }
        // Stage 3: apex fill, bottom-up from apex, slightly wider than septum
        if (fills.apex > 0.004) {
          const ah = _VH * Math.min(1, fills.apex * 1.5)
          const hw = _VSEP + (_VMAX*0.35) * Math.min(1, fills.apex)
          ctx.save(); _pVentricleMass(ctx); ctx.clip()
          ctx.fillStyle=vColor; ctx.fillRect(_VCX-hw, _VBY-ah, hw*2, ah)
          ctx.restore()
        }
        // Stage 4: lateral expansion — grows outward from septum at full height
        if (fills.lateral > 0.004) {
          const hw = _VSEP + (_VMAX-_VSEP) * Math.min(1, fills.lateral * 1.2)
          ctx.save(); _pVentricleMass(ctx); ctx.clip()
          ctx.fillStyle=vColor; ctx.fillRect(_VCX-hw, _VTY, hw*2, _VH)
          ctx.restore()
        }

        // 6. Repolarization: blue sweep (base to apex = top-down) over ventricles and atria
        if (fills.repolV > 0.004) {
          const rh = _VH * Math.min(1, fills.repolV)
          ctx.save(); _pVentricleMass(ctx); ctx.clip()
          ctx.fillStyle=BLEU; ctx.fillRect(_VCX-_VMAX-4, _VTY, (_VMAX+4)*2, rh)
          ctx.restore()
        }
        if (fills.repolA > 0.004) {
          const rh = _ACLIP.fullH * Math.min(1, fills.repolA)
          ctx.save(); _pAtriaRegion(ctx); ctx.clip()
          ctx.fillStyle=BLEU; ctx.fillRect(_ACLIP.x, _ACLIP.y, _ACLIP.w, rh)
          ctx.restore()
        }

        // 7. AV groove line
        ctx.save(); ctx.strokeStyle='#000'; ctx.lineWidth=3; ctx.lineCap='butt'
        ctx.beginPath(); ctx.moveTo(_hx(28),_hy(100)); ctx.lineTo(_hx(160),_hy(100)); ctx.stroke()
        ctx.restore()

        // 8. Thick black epicardial border (re-stroke on top)
        ctx.save(); _pOutline(ctx)
        ctx.strokeStyle='#000'; ctx.lineWidth=10; ctx.lineJoin='round'; ctx.stroke()
        ctx.restore()

        // 9. SA node — starburst shape at RA appendage peak
        const saOn = tMs >= 0 && tMs < 85
        const saFlash = saOn ? Math.sin((tMs/80)*Math.PI) : 0
        const sax = _hx(152), say = _hy(42)
        ctx.save()
        // Draw starburst polygon
        ctx.beginPath()
        for (let i=0;i<10;i++) {
          const ang = (i/10)*Math.PI*2 - Math.PI/2
          const r = i%2===0 ? (saOn?8+4*saFlash:7) : (saOn?3+saFlash:3)
          const px = sax+r*Math.cos(ang), py = say+r*Math.sin(ang)
          if(i===0)ctx.moveTo(px,py); else ctx.lineTo(px,py)
        }
        ctx.closePath()
        ctx.fillStyle = saOn ? `rgba(255,235,80,${0.8+0.2*saFlash})` : '#707060'
        ctx.strokeStyle = saOn ? '#FFFF66' : '#555'
        ctx.lineWidth=1; ctx.fill(); ctx.stroke()
        if (saOn && saFlash > 0.3) {
          ctx.globalAlpha=0.5*saFlash
          for (let i=0;i<6;i++) {
            const ang=(i/6)*Math.PI*2, rl=11+7*saFlash
            ctx.strokeStyle='#FFE040'; ctx.lineWidth=1.2
            ctx.beginPath(); ctx.moveTo(sax+7*Math.cos(ang),say+7*Math.sin(ang))
            ctx.lineTo(sax+rl*Math.cos(ang),say+rl*Math.sin(ang)); ctx.stroke()
          }
          ctx.globalAlpha=1
        }
        ctx.fillStyle='#93c5fd'; ctx.font='bold 7px sans-serif'; ctx.textAlign='left'
        ctx.fillText('SA node',_hx(158),_hy(38)); ctx.restore()

        // 10. Bachmann's bundle (dashed across top of atria)
        const bachOn = tMs>=0&&tMs<80
        ctx.save(); ctx.beginPath()
        ctx.moveTo(_hx(148),_hy(36)); ctx.quadraticCurveTo(_hx(100),_hy(16),_hx(68),_hy(32))
        ctx.strokeStyle=bachOn?'#93c5fd':'#2a3a50'
        ctx.lineWidth=bachOn?2.2:1.5; ctx.setLineDash([3,2]); ctx.stroke()
        ctx.setLineDash([]); ctx.restore()

        // 11. AV node (at AV groove, medial side)
        const avOn = tMs>=80&&tMs<180
        const avPulse = avOn ? 0.7+0.3*Math.sin(((tMs-80)/100)*Math.PI) : 0.8
        ctx.save(); ctx.beginPath(); ctx.arc(_hx(118),_hy(100),6,0,Math.PI*2)
        ctx.fillStyle=avOn?`rgba(124,58,237,${avPulse})`:'#444'
        ctx.fill(); ctx.strokeStyle=avOn?'#a78bfa':'#333'; ctx.lineWidth=1.2; ctx.stroke()
        ctx.fillStyle='#ede9fe'; ctx.font='bold 7px sans-serif'; ctx.textAlign='left'
        ctx.fillText('AV node',_hx(126),_hy(103)); ctx.restore()

        // 12. Bundle of His + branches
        const hisOn = tMs>=180&&tMs<205
        const bbOn  = tMs>=185&&tMs<225
        ctx.save(); ctx.lineCap='round'
        ctx.strokeStyle=hisOn?'#c084fc':'#252535'; ctx.lineWidth=hisOn?3:1.5
        ctx.beginPath(); ctx.moveTo(_hx(116),_hy(104)); ctx.lineTo(_hx(100),_hy(130)); ctx.stroke()
        ctx.strokeStyle=bbOn?'#db2777':'#252535'; ctx.lineWidth=bbOn?2.5:1.5
        // Left bundle (to LV — right side in canvas for this anterior-oblique view)
        ctx.beginPath(); ctx.moveTo(_hx(100),_hy(130))
        ctx.quadraticCurveTo(_hx(118),_hy(152),_hx(130),_hy(182)); ctx.stroke()
        // Right bundle (to RV — left side)
        ctx.beginPath(); ctx.moveTo(_hx(100),_hy(130))
        ctx.quadraticCurveTo(_hx(78),_hy(152),_hx(60),_hy(182)); ctx.stroke()
        ctx.restore()

        // 13. Chamber labels
        ctx.save(); ctx.textAlign='center'; ctx.font='bold 9px sans-serif'
        const darkOnYel = '#1a1000', lightOnGray = '#6a7a8a'
        ctx.fillStyle=fills.atria>0.4?darkOnYel:lightOnGray
        ctx.fillText('RA',_hx(148),_hy(60))
        ctx.fillText('LA',_hx(72),_hy(52))
        const ventrFilled = fills.lateral>0.4||(fills.apex>0.6&&fills.lateral>0)
        ctx.fillStyle=ventrFilled?darkOnYel:lightOnGray
        ctx.fillText('RV',_hx(45),_hy(168))
        ctx.fillText('LV',_hx(140),_hy(178))
        ctx.restore()

        // 14. Stage-specific directional arrows
        if (stage) {
          switch(stage.id) {
            case 1:
              curvedArrow(ctx,_hx(148),_hy(38),_hx(100),_hy(20),_hx(68),_hy(34),DARK)
              arrow(ctx,_hx(100),_hy(72),_hx(100),_hy(98),DARK)
              break
            case 2:
              arrow(ctx,_hx(112),_hy(168),_hx(78),_hy(168),DARK)
              ctx.save(); ctx.fillStyle='#ef4444'; ctx.font='8px sans-serif'; ctx.textAlign='center'
              ctx.fillText('L→R',_hx(95),_hy(157)); ctx.restore()
              break
            case 3:
              arrow(ctx,_hx(93),_hy(148),_hx(84),_hy(228),DARK)
              break
            case 4:
              arrow(ctx,_hx(108),_hy(172),_hx(148),_hy(162),DARK)
              arrow(ctx,_hx(80),_hy(172),_hx(42),_hy(162),DARK)
              break
            case 5:
              arrow(ctx,_hx(138),_hy(208),_hx(148),_hy(118),DARK)
              break
            case 7:
              arrow(ctx,_hx(142),_hy(115),_hx(122),_hy(215),BLEU)
              arrow(ctx,_hx(52),_hy(115),_hx(62),_hy(215),BLEU)
              break
            default: break
          }
        }

        // Stage annotation label box (bottom-left of heart area)
        if (stage && stage.id !== 'diastole') {
          const bx=2, by=ECG_Y-76, bw=PNL_X-8, bh=68
          rrect(ctx,bx,by,bw,bh,6,'rgba(8,12,25,0.92)','#25405a')
          const [cr,cg,cb]=stage.color||[180,180,180]
          ctx.save()
          ctx.fillStyle=`rgb(${cr},${cg},${cb})`; ctx.font='bold 8.5px monospace'; ctx.textAlign='left'
          ctx.fillText(`Stage ${stage.stageNum}`,bx+8,by+14)
          ctx.fillStyle='#cbd5e1'; ctx.font='9px monospace'
          wrapText(ctx,stage.label,bx+8,by+28,bw-16,13)
          ctx.restore()
        }

        // ── Right panel: stage info ──
        if (stage) {
          const [cr,cg,cb]=stage.color||[180,180,180]
          const pW = W - PNL_X - 10
          ctx.save()
          ctx.fillStyle='#6b7280'; ctx.font='7.5px monospace'; ctx.textAlign='left'
          ctx.fillText('CURRENT STAGE', PNL_X+8, 20)
          ctx.fillStyle=`rgb(${cr},${cg},${cb})`; ctx.font='bold 10px monospace'
          ctx.fillText(stage.stageNum, PNL_X+8, 35)
          ctx.fillStyle='#e2e8f0'; ctx.font='9.5px sans-serif'
          wrapText(ctx,stage.label, PNL_X+8, 50, pW, 13)
          ctx.fillStyle='#4b5563'; ctx.font='7.5px monospace'
          ctx.fillText('ECG CORRELATION', PNL_X+8, 82)
          ctx.fillStyle=`rgb(${cr},${cg},${cb})`; ctx.font='bold 13px monospace'
          ctx.fillText(stage.ecgPart, PNL_X+8, 98)
          if (stage.note) {
            ctx.fillStyle='#718496'; ctx.font='8px sans-serif'
            wrapText(ctx,stage.note, PNL_X+8, 116, pW, 11)
          }
          ctx.restore()
        }

        // ── Cardiac dipole mini-vector ──
        ctx.save()
        ctx.fillStyle='#374151'; ctx.font='7px monospace'; ctx.textAlign='center'
        ctx.fillText('Cardiac dipole vector', DV_CX, DV_CY-DV_R-5)
        ctx.strokeStyle='#1c2e42'; ctx.lineWidth=0.8
        ctx.beginPath(); ctx.moveTo(DV_CX-DV_R,DV_CY); ctx.lineTo(DV_CX+DV_R,DV_CY); ctx.stroke()
        ctx.beginPath(); ctx.moveTo(DV_CX,DV_CY-DV_R); ctx.lineTo(DV_CX,DV_CY+DV_R); ctx.stroke()
        ctx.beginPath(); ctx.arc(DV_CX,DV_CY,DV_R,0,Math.PI*2); ctx.stroke()
        ctx.fillStyle='#2d3f52'; ctx.font='7px monospace'
        ctx.fillText('I →', DV_CX+DV_R+10, DV_CY+3)
        ctx.fillText('aVF ↓', DV_CX, DV_CY+DV_R+10)
        const tMs2 = dataRef.current.masterTimeMs
        const cm2  = dataRef.current.cycleMs
        const w2   = dataRef.current.waves
        const Vx = (w2&&cm2)?ECGVoltage(tMs2,cm2,w2,0):0
        const Vy = (w2&&cm2)?ECGVoltage(tMs2,cm2,w2,90):0
        const mag = Math.sqrt(Vx*Vx+Vy*Vy)
        if (mag>0.005) arrow(ctx,DV_CX,DV_CY,DV_CX+Vx*DV_R*1.1,DV_CY+Vy*DV_R*1.1,'#34d399',2)
        ctx.beginPath(); ctx.arc(DV_CX,DV_CY,3,0,Math.PI*2)
        ctx.fillStyle='#9ca3af'; ctx.fill(); ctx.restore()

        // ── ECG mini-strip ──
        const sx=4, sw=632, sbl=ECG_Y+ECG_H/2
        rrect(ctx,sx,ECG_Y,sw,ECG_H,4,'#0b1120','#1a2c3e')
        ctx.save(); ctx.strokeStyle='#182030'; ctx.lineWidth=0.5
        ctx.beginPath(); ctx.moveTo(sx,sbl); ctx.lineTo(sx+sw,sbl); ctx.stroke()
        for (let xi=0;xi<=8;xi++) {
          const lx=sx+xi*sw/8
          ctx.beginPath(); ctx.moveTo(lx,ECG_Y+2); ctx.lineTo(lx,ECG_Y+ECG_H-2); ctx.stroke()
        }
        ctx.restore()
        // Region highlight
        if (stage) {
          const reg=_ECG_REGIONS.find(r=>r.stages.includes(stage.id))
          if (reg) {
            const [cr,cg,cb]=reg.color
            ctx.save()
            ctx.fillStyle=`rgba(${cr},${cg},${cb},0.18)`
            ctx.fillRect(sx+reg.from*sw, ECG_Y+2, (reg.to-reg.from)*sw, ECG_H-4)
            ctx.fillStyle=`rgb(${cr},${cg},${cb})`; ctx.font='8px monospace'; ctx.textAlign='center'
            ctx.fillText(reg.label, sx+(reg.from+reg.to)*sw/2, ECG_Y+11)
            ctx.restore()
          }
        }
        // ECG curve
        if (!ecgCache||ecgCache.length<2) ecgCache=buildCache(w,cm)
        if (ecgCache&&ecgCache.length>2) {
          const maxV=Math.max(...ecgCache.map(Math.abs),0.01)
          const amp=(ECG_H*0.38)/maxV
          ctx.save(); ctx.strokeStyle='#34d399'; ctx.lineWidth=1.6; ctx.lineJoin='round'; ctx.beginPath()
          ecgCache.forEach((v,i) => {
            const px=sx+(i/ecgCache.length)*sw, py=sbl-v*amp
            if(i===0)ctx.moveTo(px,py); else ctx.lineTo(px,py)
          })
          ctx.stroke(); ctx.restore()
        }
        // Dim region labels for inactive regions
        ctx.save(); ctx.font='7px monospace'; ctx.textAlign='center'; ctx.fillStyle='#253445'
        for (const r of _ECG_REGIONS) {
          if (stage && _ECG_REGIONS.find(er=>er.stages.includes(stage.id))?.label===r.label) continue
          ctx.fillText(r.label, sx+(r.from+r.to)*sw/2, ECG_Y+11)
        }
        ctx.restore()
        // Time cursor
        const normT=((tMs%(cm||CYCLE_MS))/(cm||CYCLE_MS))
        const tcx=sx+normT*sw
        ctx.save(); ctx.strokeStyle='rgba(255,255,255,0.45)'; ctx.lineWidth=1.2; ctx.setLineDash([3,3])
        ctx.beginPath(); ctx.moveTo(tcx,ECG_Y+2); ctx.lineTo(tcx,ECG_Y+ECG_H-2); ctx.stroke()
        ctx.setLineDash([]); ctx.restore()
        // Timestamp
        ctx.save(); ctx.fillStyle='#2d3d50'; ctx.font='7px monospace'; ctx.textAlign='right'
        ctx.fillText(`${Math.round(tMs)} ms / ${cm||CYCLE_MS} ms`, W-6, H-4); ctx.restore()
      }
    }

    const container = containerRef.current
    if (!container) return
    let inst
    const rafId = requestAnimationFrame(() => {
      if (!container.isConnected) return
      while (container.firstChild) container.removeChild(container.firstChild)
      inst = new p5(sketch, container)
      p5Ref.current = inst
    })
    return () => {
      cancelAnimationFrame(rafId); p5Ref.current = null
      if (inst) { try { inst.remove() } catch(_) {} }
      while (container.firstChild) container.removeChild(container.firstChild)
    }
  }, [])

  const stepToStage = useCallback((dir) => {
    const tMs = dataRef.current.masterTimeMs
    const bounds = [0, 80, 180, 200, 220, 240, 260, 380, 540, 800]
    if (dir > 0) {
      const next = bounds.find(b => b > tMs + 2)
      if (next != null) onScrub(next)
    } else {
      const prev = [...bounds].reverse().find(b => b < tMs - 2)
      if (prev != null) onScrub(prev)
    }
  }, [onScrub])

  const stage = _getDepolStage(masterTimeMs)

  return (
    <div className="mt-5">
      <div className="text-xs font-mono text-cyan-500 uppercase tracking-widest mb-2">
        Anatomical Depolarization Sequence — Boron &amp; Boulpaep 6-Stage Model
      </div>

      <div
        className="relative rounded-xl border border-gray-800 overflow-hidden"
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        <div ref={containerRef} />
        {tooltip && (
          <div
            className="absolute pointer-events-none z-10 px-2 py-1.5 rounded-lg bg-gray-900 border border-gray-700 text-xs text-gray-200 shadow-xl"
            style={{ left: Math.min(tipPos.x + 14, 480), top: Math.max(tipPos.y - 42, 4) }}
          >
            <div className="font-semibold text-white mb-0.5">{tooltip.name}</div>
            <div className="text-gray-400">CV: {tooltip.cv}</div>
            <div className="text-gray-500 mt-0.5 max-w-[190px] leading-tight">{tooltip.note}</div>
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button onClick={onToggle}
          className="px-4 py-1.5 rounded-lg text-xs font-medium border border-gray-700 bg-gray-800 hover:bg-gray-700 text-white transition-colors">
          {isPlaying ? 'Pause' : 'Play'}
        </button>
        <button onClick={() => stepToStage(-1)}
          className="px-3 py-1.5 rounded-lg text-xs border border-gray-700 bg-gray-800 hover:bg-gray-700 text-gray-300 transition-colors"
          title="Previous stage boundary">
          ← Stage
        </button>
        <button onClick={() => stepToStage(1)}
          className="px-3 py-1.5 rounded-lg text-xs border border-gray-700 bg-gray-800 hover:bg-gray-700 text-gray-300 transition-colors"
          title="Next stage boundary">
          Stage →
        </button>
        <button onClick={() => onScrub(0)}
          className="px-3 py-1.5 rounded-lg text-xs border border-gray-700 bg-gray-800 hover:bg-gray-700 text-gray-400 transition-colors">
          Reset
        </button>

        <div className="flex items-center gap-1.5">
          <span className="text-xs text-gray-500">Speed</span>
          {[0.5, 1, 2].map(s => (
            <button key={s} onClick={() => onSpeedChange(s)}
              className={`px-2 py-1 rounded text-xs border transition-colors ${
                speedMult === s
                  ? 'border-cyan-500 bg-cyan-950/40 text-cyan-300'
                  : 'border-gray-700 bg-gray-800 hover:bg-gray-700 text-gray-400'
              }`}>
              {s}×
            </button>
          ))}
        </div>

        {stage && (
          <span className="text-xs font-mono ml-auto" style={{ color: stage.color ? `rgb(${stage.color.join(',')})` : '#9ca3af' }}>
            {['av','diastole'].includes(stage.id) ? stage.stageNum : `Stage ${stage.stageNum}`}
            {' — '}{stage.ecgPart}
          </span>
        )}
      </div>

      {/* Scrubable timeline */}
      <div className="mt-1.5 relative">
        <input type="range" min={0} max={cycleMs||CYCLE_MS} value={masterTimeMs}
          onChange={e => onScrub(Number(e.target.value))}
          className="w-full accent-cyan-500" />
        <div className="relative h-5 mt-0.5">
          {[
            { label:'P',       t:0   },
            { label:'AV',      t:80  },
            { label:'QRS',     t:180 },
            { label:'ST',      t:260 },
            { label:'T',       t:380 },
            { label:'Diastole',t:540 },
          ].map(({ label, t }) => (
            <button key={label} onClick={() => onScrub(t)}
              className="absolute text-gray-600 hover:text-cyan-400 transition-colors"
              style={{ fontSize:'9px', left:`${(t/(cycleMs||CYCLE_MS))*100}%`, transform:'translateX(-50%)' }}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3 flex gap-3 text-xs text-gray-500">
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{background:'#F5C518'}} /> Depolarized
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{background:'#87CEEB'}} /> Repolarizing
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{background:'#888888'}} /> Resting
        </span>
        <span className="ml-auto text-gray-600">Hover chambers for conduction velocity</span>
      </div>
    </div>
  )
}

// ── Layout helpers ─────────────────────────────────────────────────────────
function CanvasWrap({ containerRef, children }) {
  return (
    <div className="rounded-xl overflow-hidden border border-gray-800 mb-4">
      <div ref={containerRef} />
      {children}
    </div>
  )
}
function SimBar({ children }) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 bg-gray-900/80 border-t border-gray-800 text-xs text-gray-500 flex-wrap">
      {children}
    </div>
  )
}
function Section({ label, title, subtitle, children }) {
  return (
    <div className="mb-10">
      <div className="flex items-baseline gap-3 mb-1">
        <span className="text-xs font-mono text-cyan-500 uppercase tracking-widest">{label}</span>
        <h2 className="text-lg font-semibold text-white">{title}</h2>
      </div>
      {subtitle && <p className="text-sm text-gray-400 mb-4">{subtitle}</p>}
      {children}
    </div>
  )
}
function Callout({ children }) {
  return (
    <div className="mt-3 px-4 py-3 rounded-lg bg-cyan-950/40 border border-cyan-800/30 text-xs text-cyan-300 leading-relaxed">
      {children}
    </div>
  )
}
function InfoRow({ label, value }) {
  return (
    <div className="flex gap-2 text-xs leading-relaxed mb-1.5">
      <span className="text-gray-500 shrink-0 w-28">{label}</span>
      <span className="text-gray-200">{value}</span>
    </div>
  )
}

// ── 2A: Heart Anatomy Overview ─────────────────────────────────────────────
function AnatomyDiagram({ selected, onSelect }) {
  const [hovered, setHovered] = useState(null)
  const active = hovered || selected

  const ev = (key) => ({
    onMouseEnter: () => setHovered(key),
    onMouseLeave: () => setHovered(null),
    onClick: () => onSelect(prev => prev === key ? null : key),
    style: { cursor: 'pointer' },
  })

  const fill = (key, base, highlight) => {
    if (active === key) return highlight
    return base
  }

  const info = active ? ANATOMY[active] : null

  return (
    <div className="flex gap-4 items-start">
      {/* SVG Heart */}
      <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-3 shrink-0">
        <svg viewBox="0 0 200 262" width="210" height="262" className="block">
          {/* ── Non-interactive structure labels ── */}
          <text x="100" y="8" textAnchor="middle" fill="#6b7280" fontSize="5">Patient's Right ← → Patient's Left</text>

          {/* Bachmann's bundle (non-interactive, dashed) */}
          <path d="M 76 22 Q 100 20 124 28" fill="none" stroke="#6b7280" strokeWidth="1.5" strokeDasharray="2,2" />
          <text x="100" y="18" textAnchor="middle" fill="#6b7280" fontSize="4.5">Bachmann's bundle</text>

          {/* ── Right Atrium (viewer left = patient right) ── */}
          <path
            d="M 62 42 Q 62 28 80 26 Q 98 24 98 42 Q 98 75 70 88 Q 58 80 58 65 Z"
            fill={fill('ra', '#1e3a2e', '#166534')}
            stroke={active === 'ra' ? '#4ade80' : '#374151'}
            strokeWidth="1.5"
            {...ev('ra')}
          />
          <text x="76" y="60" textAnchor="middle" fill="#d1fae5" fontSize="6" pointerEvents="none">RA</text>

          {/* ── Left Atrium (viewer right = patient left) ── */}
          <path
            d="M 102 42 Q 102 24 120 26 Q 138 28 138 42 Q 138 65 130 80 Q 118 88 102 75 Z"
            fill={fill('la', '#1e3a2e', '#166534')}
            stroke={active === 'la' ? '#4ade80' : '#374151'}
            strokeWidth="1.5"
            {...ev('la')}
          />
          <text x="120" y="60" textAnchor="middle" fill="#d1fae5" fontSize="6" pointerEvents="none">LA</text>

          {/* ── SA Node (viewer left, patient right) ── */}
          <circle
            cx="70" cy="18" r="7"
            fill={fill('sa', '#1e2a4e', '#1d4ed8')}
            stroke={active === 'sa' ? '#60a5fa' : '#374151'}
            strokeWidth="1.5"
            {...ev('sa')}
          />
          <text x="70" y="20" textAnchor="middle" fill="#bfdbfe" fontSize="5" pointerEvents="none">SA</text>

          {/* ── AV Node ── */}
          <circle
            cx="100" cy="97" r="7"
            fill={fill('av', '#2d1a4e', '#6d28d9')}
            stroke={active === 'av' ? '#a78bfa' : '#374151'}
            strokeWidth="1.5"
            {...ev('av')}
          />
          <text x="100" y="99" textAnchor="middle" fill="#ede9fe" fontSize="5" pointerEvents="none">AV</text>

          {/* ── Bundle of His ── */}
          <line x1="100" y1="104" x2="100" y2="117"
            stroke={active === 'his' ? '#c084fc' : '#6b7280'} strokeWidth="2.5"
            {...ev('his')} style={{ cursor: 'pointer' }}
          />
          <rect x="88" y="104" width="24" height="13" fill="transparent" {...ev('his')} />
          <text x="113" y="113" fill="#9ca3af" fontSize="4.5" pointerEvents="none">His</text>

          {/* ── Right Bundle Branch (viewer left) ── */}
          <path
            d="M 97 119 Q 80 130 65 148 Q 58 158 62 170"
            fill="none"
            stroke={fill('rbundle', '#4b5563', '#db2777')}
            strokeWidth="2"
            {...ev('rbundle')} style={{ cursor: 'pointer' }}
          />
          <text x="58" y="138" fill="#9ca3af" fontSize="4.5" pointerEvents="none">RBB</text>

          {/* ── Left Bundle Branch (viewer right) ── */}
          <path
            d="M 103 119 Q 120 130 135 148 Q 142 158 138 170"
            fill="none"
            stroke={fill('lbundle', '#4b5563', '#db2777')}
            strokeWidth="2"
            {...ev('lbundle')} style={{ cursor: 'pointer' }}
          />
          <text x="136" y="138" fill="#9ca3af" fontSize="4.5" pointerEvents="none">LBB</text>

          {/* ── Purkinje fan hints (apex region) ── */}
          <path d="M 62 170 Q 70 195 85 210 Q 95 222 100 228"
            fill="none" stroke="#4b5563" strokeWidth="1" strokeDasharray="1.5,1.5"
            {...ev('purkinje')} style={{ cursor: 'pointer' }}
          />
          <path d="M 138 170 Q 130 195 115 210 Q 105 222 100 228"
            fill="none" stroke="#4b5563" strokeWidth="1" strokeDasharray="1.5,1.5"
            {...ev('purkinje')} style={{ cursor: 'pointer' }}
          />
          <text x="100" y="240" textAnchor="middle" fill="#6b7280" fontSize="4.5" pointerEvents="none">Purkinje</text>

          {/* ── Right Ventricle (viewer left) ── */}
          <path
            d="M 58 95 Q 42 110 40 140 Q 38 170 60 190 Q 80 210 100 228 Q 98 200 95 175 Q 90 148 88 125 Q 80 105 70 97 Z"
            fill={fill('rv', '#1f2937', '#7c2d12')}
            stroke={active === 'rv' ? '#fb923c' : '#374151'}
            strokeWidth="1.5"
            {...ev('rv')}
          />
          <text x="64" y="168" textAnchor="middle" fill="#fed7aa" fontSize="6" pointerEvents="none">RV</text>

          {/* ── Left Ventricle (viewer right) ── */}
          <path
            d="M 142 95 Q 158 110 160 140 Q 162 170 140 190 Q 120 210 100 228 Q 102 200 105 175 Q 110 148 112 125 Q 120 105 130 97 Z"
            fill={fill('lv', '#1f2937', '#7c2d12')}
            stroke={active === 'lv' ? '#fb923c' : '#374151'}
            strokeWidth="1.5"
            {...ev('lv')}
          />
          <text x="136" y="168" textAnchor="middle" fill="#fed7aa" fontSize="6" pointerEvents="none">LV</text>

          {/* ── Interventricular Septum ── */}
          <path
            d="M 88 125 Q 92 148 95 175 Q 97 200 100 228 Q 103 200 105 175 Q 108 148 112 125 Q 105 110 100 107 Q 95 110 88 125 Z"
            fill={fill('septum', '#111827', '#1e3a5f')}
            stroke={active === 'septum' ? '#38bdf8' : '#374151'}
            strokeWidth="1"
            {...ev('septum')}
          />
          <text x="100" y="165" textAnchor="middle" fill="#7dd3fc" fontSize="4" pointerEvents="none">IVS</text>
        </svg>
      </div>

      {/* Info panel */}
      <div className="flex-1 min-h-[262px] flex flex-col justify-start">
        {info ? (
          <div className="rounded-xl border border-gray-700 bg-gray-900/80 p-4 h-full">
            <h3 className="text-sm font-semibold text-white mb-3">{info.name}</h3>
            <InfoRow label="Primary function" value={info.fn} />
            <InfoRow label="Electrical role" value={info.electrical} />
            <InfoRow label="ECG correlation" value={info.ECG} />
          </div>
        ) : (
          <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-4 h-full flex flex-col justify-center text-center">
            <p className="text-gray-500 text-sm">Hover or click a structure</p>
            <p className="text-gray-600 text-xs mt-2">SA Node · RA · LA · AV Node · Bundle of His · Bundle Branches · Purkinje · RV · LV · Septum</p>
          </div>
        )}
      </div>
    </div>
  )
}

// ── 2B: Action Potentials by Cell Type ────────────────────────────────────
const AP_VMIN = -100, AP_VMAX = 45
const AP_PAD = { l: 44, r: 14, t: 28, b: 20 }
const AP_H = 190

const AP_PHASE_COLORS = {
  p4:    [59,  130, 246, 40],
  p0:    [239, 68,  68,  50],
  p1:    [234, 179, 8,   45],
  p2:    [16,  185, 129, 40],
  p3:    [168, 85,  247, 40],
  p4r:   [59,  130, 246, 40],
  p4d:   [59,  130, 246, 40],
  repol: [168, 85,  247, 40],
}

// One canvas per cell type — avoids horizontal layout / clipping issues
function APPanel({ panelKey, title, sub, data, phases, isSelected, onHover }) {
  const containerRef = useRef()
  const isSelectedRef = useRef(isSelected)
  const hoverPhaseRef = useRef(null)

  useEffect(() => { isSelectedRef.current = isSelected }, [isSelected])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    let inst
    const rafId = requestAnimationFrame(() => {
      if (!container.isConnected) return
      const W = Math.max(container.clientWidth || 0, 260)
      const dW = W - AP_PAD.l - AP_PAD.r
      const dH = AP_H - AP_PAD.t - AP_PAD.b

      const toX = (t) => AP_PAD.l + t * dW
      const toY = (v) => AP_PAD.t + (AP_VMAX - v) / (AP_VMAX - AP_VMIN) * dH

      const sketch = (p) => {
        p.setup = () => { p.createCanvas(W, AP_H) }
        p.draw = () => {
          p.background(17, 24, 39)

          if (isSelectedRef.current) {
            p.noFill(); p.stroke(6, 182, 212, 100); p.strokeWeight(2)
            p.rect(1, 1, W - 2, AP_H - 2)
          }

          phases.forEach(phase => {
            const [t0, t1] = phase.tRange
            const col = AP_PHASE_COLORS[phase.id] || [100, 100, 100, 25]
            p.fill(col[0], col[1], col[2], col[3])
            p.noStroke()
            p.rect(toX(t0), AP_PAD.t, toX(t1) - toX(t0), dH)
          })

          const hov = hoverPhaseRef.current
          if (hov) {
            const [ht0, ht1] = hov.tRange
            const col = AP_PHASE_COLORS[hov.id] || [200, 200, 200, 80]
            p.fill(col[0], col[1], col[2], 80)
            p.noStroke()
            p.rect(toX(ht0), AP_PAD.t, toX(ht1) - toX(ht0), dH)
            const lx = toX((ht0 + ht1) / 2)
            p.noStroke(); p.fill(240, 240, 240); p.textSize(8); p.textAlign(p.CENTER)
            p.text(hov.label.split(' — ')[0], lx, AP_PAD.t - 6)
          }

          const gridVs = [-90, -60, -30, 0, 30]
          gridVs.forEach(v => {
            const gy = toY(v)
            if (gy < AP_PAD.t || gy > AP_H - AP_PAD.b) return
            p.stroke(v === 0 ? 80 : 45, v === 0 ? 95 : 55, v === 0 ? 120 : 72)
            p.strokeWeight(v === 0 ? 1.0 : 0.5)
            p.line(AP_PAD.l, gy, W - AP_PAD.r, gy)
            p.noStroke(); p.fill(100, 110, 130); p.textSize(8); p.textAlign(p.RIGHT)
            p.text(v + ' mV', AP_PAD.l - 4, gy + 3)
          })

          p.stroke(52, 211, 153); p.strokeWeight(2.0); p.noFill()
          p.beginShape()
          data.forEach(([t, v]) => p.vertex(toX(t), toY(v)))
          p.endShape()

          p.strokeWeight(0.6)
          phases.forEach(({ tRange: [t0] }, i) => {
            if (i === 0) return
            const x = toX(t0)
            p.stroke(60, 70, 90)
            p.line(x, AP_PAD.t, x, AP_H - AP_PAD.b)
          })
        }
      }

      while (container.firstChild) container.removeChild(container.firstChild)
      inst = new p5(sketch, container)
    })
    return () => {
      cancelAnimationFrame(rafId)
      if (inst) { try { inst.remove() } catch (_) {} }
      while (container.firstChild) container.removeChild(container.firstChild)
    }
  }, [data, phases])

  // Mouse detection: use canvas.getBoundingClientRect() + scaling to handle any CSS resize
  const handleMouseMove = useCallback((e) => {
    const canvas = containerRef.current?.querySelector('canvas')
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    const mx = (e.clientX - rect.left) * scaleX
    const my = (e.clientY - rect.top) * scaleY
    const dW = canvas.width - AP_PAD.l - AP_PAD.r
    const inChart = mx >= AP_PAD.l && mx <= canvas.width - AP_PAD.r
                 && my >= AP_PAD.t && my <= canvas.height - AP_PAD.b
    if (!inChart) {
      if (hoverPhaseRef.current) { hoverPhaseRef.current = null; onHover(null) }
      return
    }
    const tFrac = (mx - AP_PAD.l) / dW
    const phase = phases.find(ph => tFrac >= ph.tRange[0] && tFrac < ph.tRange[1]) || null
    hoverPhaseRef.current = phase
    onHover(phase ? { panelKey, panelTitle: title, phase } : null)
  }, [phases, panelKey, title, onHover])

  const handleMouseLeave = useCallback(() => {
    hoverPhaseRef.current = null
    onHover(null)
  }, [onHover])

  return (
    <div
      className={`border-b border-gray-800 last:border-b-0 ${isSelected ? 'ring-1 ring-cyan-500/50' : ''}`}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      <div className="flex items-baseline gap-2 px-4 pt-2 pb-1">
        <span className="text-xs font-semibold text-gray-200">{title}</span>
        <span className="text-xs text-gray-500">{sub}</span>
      </div>
      <div ref={containerRef} />
    </div>
  )
}

function ActionPotentials({ selectedKey }) {
  const [ionInfo, setIonInfo] = useState(null)

  const panels = useMemo(() => [
    { key: 'sa',       title: 'SA Node',                      sub: 'Automaticity',              data: SA_AP,  phases: SA_PHASES  },
    { key: 'myocyte',  title: 'Atrial / Ventricular Myocyte', sub: 'Phases 0–4',                data: MYO_AP, phases: MYO_PHASES },
    { key: 'purkinje', title: 'Purkinje Fiber',               sub: 'Fastest · Longest plateau', data: PK_AP,  phases: PK_PHASES  },
  ], [])

  return (
    <div>
      <div className="rounded-xl border border-gray-800 overflow-hidden mb-3">
        <div className="flex items-center justify-between bg-gray-900 border-b border-gray-800 px-3 py-2 text-xs text-gray-400">
          <span>Hover within a panel to see ion channel detail for that phase</span>
          {selectedKey && (
            <span className="text-cyan-400">
              Highlighting: {selectedKey === 'sa' ? 'SA Node' : selectedKey === 'myocyte' ? 'Myocyte' : 'Purkinje'} (from 2A)
            </span>
          )}
        </div>
        {panels.map(panel => (
          <APPanel
            key={panel.key}
            panelKey={panel.key}
            title={panel.title}
            sub={panel.sub}
            data={panel.data}
            phases={panel.phases}
            isSelected={selectedKey === panel.key}
            onHover={setIonInfo}
          />
        ))}
      </div>
      {ionInfo ? (
        <div className="rounded-xl border border-gray-700 bg-gray-900/80 p-4 text-xs">
          <div className="text-xs text-cyan-400 mb-2">{ionInfo.panelTitle} — {ionInfo.phase.label}</div>
          <InfoRow label="Key channels" value={ionInfo.phase.channels} />
          <InfoRow label="Ion movement" value={ionInfo.phase.ions} />
        </div>
      ) : (
        <div className="rounded-xl border border-gray-800 bg-gray-900/40 px-4 py-3 text-xs text-gray-600 text-center">
          Hover over a phase region to see ion channel detail
        </div>
      )}
    </div>
  )
}

// ── 2C: Conduction Animation ───────────────────────────────────────────────
function ConductionSection({ clockRef, rhythm, conductionMap, masterTimeMs, isPlaying, onToggle, onScrub, onStep, speedMult, onSpeedChange }) {
  const tMs = masterTimeMs
  const cycleMs = rhythm.cycleMs || CYCLE_MS

  const { structName, cv, note } = useMemo(() => {
    if (!conductionMap || conductionMap.length === 0)
      return { structName: 'Diastole', cv: '—', note: '' }
    for (const e of conductionMap) {
      if (tMs >= e.onsetMs && tMs < e.offsetMs && e.state !== 'meta') {
        const id = e.id
        return {
          structName: STRUCT_NAMES[id] || id,
          cv: STRUCT_CV[id] || '—',
          note: STRUCT_NOTE[id] || '',
        }
      }
    }
    return { structName: 'Diastole (rest)', cv: '—', note: 'Heart muscle at rest. SA node building toward next pacemaker potential.' }
  }, [conductionMap, tMs])

  const velTable = [
    { struct: 'SA Node',             cv: '—' },
    { struct: 'Atrial myocardium',   cv: '1.0 m/s' },
    { struct: 'AV Node',             cv: '0.05 m/s' },
    { struct: 'Bundle of His',       cv: '1.0 m/s' },
    { struct: 'Bundle Branches',     cv: '2–4 m/s' },
    { struct: 'Purkinje Fibers',     cv: '2–4 m/s' },
    { struct: 'Ventricular muscle',  cv: '0.3–0.5 m/s' },
  ]

  return (
    <div>
      <div className="flex gap-4 items-start mb-4">
        {/* Heart animation */}
        <div className="rounded-xl border border-gray-800 overflow-hidden shrink-0">
          <HeartAnimation
            clockRef={clockRef}
            rhythmId="normalSinus"
            rhythm={rhythm}
          />
        </div>

        {/* Side panel */}
        <div className="flex-1 space-y-3">
          <div className="rounded-xl border border-gray-700 bg-gray-900/80 p-4 min-h-[120px]">
            <div className="text-xs text-cyan-400 mb-2">Active Structure</div>
            <div className="text-sm font-semibold text-white mb-2 min-h-[20px]">{structName}</div>
            <InfoRow label="Conduction vel." value={cv} />
            <div className="mt-2 min-h-[48px]">
              <p className="text-xs text-gray-400 leading-relaxed">{note || ' '}</p>
            </div>
          </div>

          {/* Velocity table */}
          <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-3">
            <div className="text-xs text-gray-500 mb-2 font-mono uppercase tracking-wider">Conduction Velocity Reference</div>
            <table className="w-full text-xs">
              <tbody>
                {velTable.map(row => (
                  <tr key={row.struct} className={structName === row.struct ? 'text-cyan-300' : 'text-gray-400'}>
                    <td className="py-0.5 pr-3">{row.struct}</td>
                    <td className="py-0.5 font-mono text-right">{row.cv}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={onToggle}
          className="px-4 py-1.5 rounded-lg text-xs font-medium border border-gray-700 bg-gray-800 hover:bg-gray-700 text-white transition-colors"
        >
          {isPlaying ? 'Pause' : 'Play'}
        </button>
        <button
          onClick={onStep}
          className="px-4 py-1.5 rounded-lg text-xs font-medium border border-gray-700 bg-gray-800 hover:bg-gray-700 text-gray-300 transition-colors"
        >
          +10 ms
        </button>
        <button
          onClick={() => onScrub(0)}
          className="px-4 py-1.5 rounded-lg text-xs font-medium border border-gray-700 bg-gray-800 hover:bg-gray-700 text-gray-300 transition-colors"
        >
          Reset
        </button>
        <input
          type="range"
          min={0}
          max={cycleMs}
          value={tMs}
          onChange={e => onScrub(Number(e.target.value))}
          className="flex-1 min-w-[120px] accent-cyan-500"
        />
        <span className="text-xs font-mono text-gray-500 tabular-nums w-20">{tMs} / {cycleMs} ms</span>
      </div>

      <DepolarizationSequence
        masterTimeMs={masterTimeMs}
        cycleMs={rhythm.cycleMs}
        waves={rhythm.waves}
        onScrub={onScrub}
        isPlaying={isPlaying}
        onToggle={onToggle}
        speedMult={speedMult}
        onSpeedChange={onSpeedChange}
      />
    </div>
  )
}

// ── 2D: Wavefront Dipole ───────────────────────────────────────────────────
function WavefrontDipole({ clockRef, waves, cycleMs, conductionMap, currentTimeMs }) {
  const containerRef = useRef()
  const p5InstRef = useRef(null)
  const dataRef = useRef({ waves, cycleMs, conductionMap, currentTimeMs })

  useEffect(() => {
    dataRef.current = { waves, cycleMs, conductionMap, currentTimeMs }
    p5InstRef.current?.redraw()
  }, [waves, cycleMs, conductionMap, currentTimeMs])

  useEffect(() => {
    const W = 520, H = 300
    // Heart schematic geometry
    const CX = 180, CY = 145  // center of heart
    const OX = 390, OY = 175  // dipole arrow origin
    const SCALE = 90

    const sketch = (p) => {
      p.setup = () => {
        p.createCanvas(W, H)
        p.noLoop()
      }

      p.draw = () => {
        p.background(17, 24, 39)
        const { waves: w, cycleMs: cm, conductionMap: cmap, currentTimeMs: tMs } = dataRef.current

        const isActive = (id) => {
          if (!cmap) return false
          return cmap.some(e => e.id === id && tMs >= e.onsetMs && tMs < e.offsetMs && e.state !== 'meta')
        }

        const getColor = (ids) => {
          // depolarizing = blue, resting = dark warm
          const active = ids.some(id => isActive(id))
          if (active) return [59, 130, 246]
          return [55, 30, 30]
        }

        // ── Heart schematic ──
        // Left panel label
        p.noStroke()
        p.fill(100, 116, 139)
        p.textSize(8)
        p.textAlign(p.CENTER)
        p.text('Heart (schematic)', CX, 14)

        // Atria region
        const atriaColor = getColor(['ra', 'la', 'sa', 'bachmann'])
        p.fill(...atriaColor, 200)
        p.stroke(80, 80, 80)
        p.strokeWeight(1)
        p.ellipse(CX, CY - 55, 90, 55)
        p.noStroke()
        p.fill(180, 180, 180)
        p.textSize(7)
        p.textAlign(p.CENTER)
        p.text('Atria', CX, CY - 52)

        // RV (viewer left) — smaller
        const rvColor = getColor(['rv'])
        p.fill(...rvColor, 200)
        p.stroke(80, 80, 80)
        p.strokeWeight(1)
        p.ellipse(CX - 42, CY + 28, 65, 90)

        // LV (viewer right) — larger
        const lvColor = getColor(['lv', 'apex'])
        p.fill(...lvColor, 200)
        p.stroke(80, 80, 80)
        p.strokeWeight(1)
        p.ellipse(CX + 38, CY + 28, 85, 110)

        // Septum
        const sepColor = getColor(['lbundle', 'rbundle', 'his'])
        p.fill(...sepColor, 200)
        p.ellipse(CX, CY + 28, 22, 70)

        // Labels
        p.noStroke()
        p.fill(200, 200, 200)
        p.textSize(7)
        p.textAlign(p.CENTER)
        p.text('RV', CX - 42, CY + 32)
        p.text('LV', CX + 38, CY + 32)
        p.fill(100, 116, 139)
        p.text('(P-right)', CX - 42, CY + 44)
        p.text('(P-left)', CX + 38, CY + 44)

        // AV node dot
        if (isActive('av')) {
          p.fill(139, 92, 246)
          p.ellipse(CX, CY - 18, 10, 10)
        }

        // Repol overlay (amber) for repolLV / repolRV
        const repolLVActive = isActive('repolLV')
        const repolRVActive = isActive('repolRV')
        if (repolLVActive) {
          p.fill(245, 158, 11, 90)
          p.noStroke()
          p.ellipse(CX + 38, CY + 28, 85, 110)
        }
        if (repolRVActive) {
          p.fill(245, 158, 11, 90)
          p.noStroke()
          p.ellipse(CX - 42, CY + 28, 65, 90)
        }

        // ── Cardiac vector ──
        const Vx = (w && cm) ? ECGVoltage(tMs, cm, w, 0) : 0
        const Vy = (w && cm) ? ECGVoltage(tMs, cm, w, 90) : 0
        const mag = Math.sqrt(Vx * Vx + Vy * Vy)

        // Right panel background
        p.fill(22, 30, 46)
        p.noStroke()
        p.rect(290, 20, 220, 260, 8)

        p.noStroke()
        p.fill(100, 116, 139)
        p.textSize(8)
        p.textAlign(p.CENTER)
        p.text('Cardiac Dipole Vector', OX, 40)

        // Axis cross
        p.stroke(50, 60, 80)
        p.strokeWeight(0.8)
        p.line(OX - 90, OY, OX + 90, OY)
        p.line(OX, OY - 90, OX, OY + 90)
        p.noStroke()
        p.fill(70, 80, 100)
        p.textSize(7)
        p.textAlign(p.CENTER)
        p.text('I (→)', OX + 94, OY + 3)
        p.text('aVF (↓)', OX, OY + 100)

        // Arrow
        if (mag > 0.005) {
          const ax = Vx * SCALE, ay = Vy * SCALE
          p.stroke(52, 211, 153)
          p.strokeWeight(2)
          p.line(OX, OY, OX + ax, OY + ay)
          // Arrowhead
          const angle = Math.atan2(ay, ax)
          const hLen = 8
          p.fill(52, 211, 153)
          p.noStroke()
          p.triangle(
            OX + ax, OY + ay,
            OX + ax - hLen * Math.cos(angle - 0.4), OY + ay - hLen * Math.sin(angle - 0.4),
            OX + ax - hLen * Math.cos(angle + 0.4), OY + ay - hLen * Math.sin(angle + 0.4)
          )
        }

        // Origin dot
        p.fill(200, 200, 200)
        p.noStroke()
        p.circle(OX, OY, 5)

        // Vector readout
        p.fill(180, 190, 200)
        p.textSize(8)
        p.textAlign(p.LEFT)
        p.text(`Vx (Lead I):  ${Vx.toFixed(3)} mV`, 300, 80)
        p.text(`Vy (aVF):     ${Vy.toFixed(3)} mV`, 300, 92)
        const deg = (Math.atan2(Vy, Vx) * 180 / Math.PI).toFixed(0)
        p.text(`Axis:          ${deg}°`, 300, 104)
        p.text(`|V|:           ${mag.toFixed(3)} mV`, 300, 116)

        // Time readout — left panel, below heart schematic
        p.fill(100, 116, 139)
        p.textSize(7)
        p.textAlign(p.LEFT)
        p.text(`t = ${Math.round(tMs)} ms`, 8, H - 10)

        // Annotation — right panel bottom
        p.fill(103, 232, 249)
        p.textSize(7)
        p.textAlign(p.CENTER)
        p.text('The −/+ boundary = dipole (Module 1 §1B)', OX, H - 10)
      }
    }

    const container = containerRef.current
    if (!container) return
    let inst
    const rafId = requestAnimationFrame(() => {
      if (!container.isConnected) return
      while (container.firstChild) container.removeChild(container.firstChild)
      inst = new p5(sketch, container)
      p5InstRef.current = inst
    })
    return () => {
      cancelAnimationFrame(rafId)
      p5InstRef.current = null
      if (inst) { try { inst.remove() } catch (_) {} }
      while (container.firstChild) container.removeChild(container.firstChild)
    }
  }, [])  // mount once — data comes in via dataRef + redraw()

  return (
    <CanvasWrap containerRef={containerRef}>
      <SimBar>
        <span>Green arrow = net cardiac dipole vector · synchronized with master clock · blue = depolarizing · amber = repolarizing</span>
      </SimBar>
    </CanvasWrap>
  )
}

// ── 2E: Cardiac Vector Cycle ───────────────────────────────────────────────
function VectorCycle({ clockRef, waves, cycleMs, currentTimeMs }) {
  const containerRef = useRef()
  const p5InstRef = useRef(null)
  const dataRef = useRef({ waves, cycleMs, currentTimeMs })

  // Update data then immediately trigger one draw — avoids rAF timing race
  useEffect(() => {
    dataRef.current = { waves, cycleMs, currentTimeMs }
    p5InstRef.current?.redraw()
  }, [waves, cycleMs, currentTimeMs])

  useEffect(() => {
    const W = 520, H = 300
    const VCX = 115, VCY = 155, VR = 85
    const EX = 248, EW = 255, EY = 80, EH = 160

    const sketch = (p) => {
      let ECGCache = null
      let waveRegions = null

      const buildCache = (w, cm) => {
        if (!w || !cm) return []
        const N = 400
        return Array.from({ length: N }, (_, i) => ECGVoltage((i / N) * cm, cm, w, 60))
      }

      const buildRegions = (w, cm) => {
        if (!w) return []
        const regions = []
        const pWave = w.find(wv => wv.name === 'P')
        const qrsR = w.find(wv => wv.name === 'R')
        const tWave = w.find(wv => wv.name === 'T')
        if (pWave) {
          const s = pWave.center - pWave.sigma * 2.5
          const e = pWave.center + pWave.sigma * 2.5
          regions.push({ label: 'P', color: [59, 130, 246], start: Math.max(0, s), end: Math.min(cm, e) })
        }
        if (qrsR) {
          const s = qrsR.center - 60
          const e = qrsR.center + 60
          regions.push({ label: 'QRS', color: [139, 92, 246], start: Math.max(0, s), end: Math.min(cm || 800, e) })
        }
        if (tWave) {
          const s = tWave.center - tWave.sigma * 2.5
          const e = tWave.center + tWave.sigma * 2.5
          regions.push({ label: 'T', color: [245, 158, 11], start: Math.max(0, s), end: Math.min(cm || 800, e) })
        }
        return regions
      }

      p.setup = () => {
        p.createCanvas(W, H)
        p.noLoop()  // driven by redraw() calls, not the internal 60fps loop
      }

      p.draw = () => {
        p.background(17, 24, 39)
        const { waves: w, cycleMs: cm, currentTimeMs: tMs } = dataRef.current

        if (!ECGCache || ECGCache.length === 0) ECGCache = buildCache(w, cm)
        if (!waveRegions) waveRegions = buildRegions(w, cm)

        const Vx = (w && cm) ? ECGVoltage(tMs, cm, w, 0) : 0
        const Vy = (w && cm) ? ECGVoltage(tMs, cm, w, 90) : 0
        const mag = Math.sqrt(Vx * Vx + Vy * Vy)
        const angle = Math.atan2(Vy, Vx)

        // ── Left panel: Vector wheel ──
        p.noStroke()
        p.fill(22, 30, 46)
        p.rect(0, 0, 230, H)

        p.noStroke()
        p.fill(100, 116, 139)
        p.textSize(8)
        p.textAlign(p.CENTER)
        p.text('Cardiac Vector (frontal plane)', VCX, 20)

        // Limb lead axes (dashed)
        const leads = [
          { label: 'I',    angle: 0 },
          { label: 'II',   angle: Math.PI / 3 },
          { label: 'III',  angle: 2 * Math.PI / 3 },
          { label: 'aVR',  angle: -2 * Math.PI / 3 },
          { label: 'aVL',  angle: -Math.PI / 3 },
          { label: 'aVF',  angle: Math.PI / 2 },
        ]
        leads.forEach(({ label, angle: la }) => {
          p.stroke(45, 55, 72)
          p.strokeWeight(0.8)
          p.drawingContext.setLineDash([3, 3])
          const ex = VCX + Math.cos(la) * VR, ey = VCY + Math.sin(la) * VR
          const sx = VCX - Math.cos(la) * VR, sy = VCY - Math.sin(la) * VR
          p.line(sx, sy, ex, ey)
          p.drawingContext.setLineDash([])
          p.noStroke()
          p.fill(75, 85, 99)
          p.textSize(7)
          p.textAlign(p.CENTER)
          const lx = VCX + Math.cos(la) * (VR + 12), ly = VCY + Math.sin(la) * (VR + 12)
          p.text(label, lx, ly + 2)
        })

        // Wheel circle
        p.noFill()
        p.stroke(40, 50, 65)
        p.strokeWeight(0.8)
        p.circle(VCX, VCY, VR * 2)

        // Lead I projection (blue dashed on x-axis)
        const projLen = Vx * VR  // dot with unit [1,0]
        p.stroke(59, 130, 246, 120)
        p.strokeWeight(1)
        p.drawingContext.setLineDash([2, 2])
        p.line(VCX + projLen, VCY - 6, VCX + projLen, VCY + 6)
        p.line(VCX, VCY, VCX + projLen, VCY)
        p.drawingContext.setLineDash([])

        // Cardiac vector arrow
        if (mag > 0.005) {
          const VSCALE = VR * 1.0
          const ax = Math.cos(angle) * mag * VSCALE
          const ay = Math.sin(angle) * mag * VSCALE
          p.stroke(52, 211, 153)
          p.strokeWeight(2.2)
          p.line(VCX, VCY, VCX + ax, VCY + ay)
          const hLen = 8
          p.fill(52, 211, 153)
          p.noStroke()
          p.triangle(
            VCX + ax, VCY + ay,
            VCX + ax - hLen * Math.cos(angle - 0.4), VCY + ay - hLen * Math.sin(angle - 0.4),
            VCX + ax - hLen * Math.cos(angle + 0.4), VCY + ay - hLen * Math.sin(angle + 0.4)
          )
        }
        p.fill(200, 200, 200)
        p.noStroke()
        p.circle(VCX, VCY, 5)

        // ── Right panel: ECG strip (Lead II) ──
        p.noStroke()
        p.fill(22, 30, 46)
        p.rect(235, 0, W - 235, H)

        p.fill(100, 116, 139)
        p.textSize(8)
        p.textAlign(p.CENTER)
        p.text('Lead II ECG', EX + EW / 2, 20)

        // Wave region shading
        if (waveRegions) {
          waveRegions.forEach(({ label, color, start, end }) => {
            const rx = EX + (start / (cm || CYCLE_MS)) * EW
            const rw = ((end - start) / (cm || CYCLE_MS)) * EW
            p.fill(color[0], color[1], color[2], 30)
            p.noStroke()
            p.rect(rx, EY, rw, EH)
            p.fill(color[0], color[1], color[2], 150)
            p.textSize(7)
            p.textAlign(p.CENTER)
            p.text(label, rx + rw / 2, EY + 10)
          })
        }

        // ECG grid
        p.stroke(40, 50, 65)
        p.strokeWeight(0.5)
        p.line(EX, EY, EX + EW, EY)
        p.line(EX, EY + EH, EX + EW, EY + EH)
        p.line(EX, EY + EH / 2, EX + EW, EY + EH / 2)
        p.strokeWeight(0.4)
        for (let xi = 0; xi <= 4; xi++) {
          p.line(EX + xi * EW / 4, EY, EX + xi * EW / 4, EY + EH)
        }

        // ECG curve
        if (ECGCache && ECGCache.length > 0) {
          const maxV = Math.max(...ECGCache.map(Math.abs)) || 1
          p.stroke(52, 211, 153)
          p.strokeWeight(1.8)
          p.noFill()
          p.beginShape()
          const f0 = ECGCache[0]
          p.curveVertex(EX, EY + EH / 2 - (f0 / maxV) * (EH / 2 - 8))
          ECGCache.forEach((v, i) => {
            const px = EX + (i / ECGCache.length) * EW
            const py = EY + EH / 2 - (v / maxV) * (EH / 2 - 8)
            p.curveVertex(px, py)
          })
          const fn = ECGCache[ECGCache.length - 1]
          p.curveVertex(EX + EW, EY + EH / 2 - (fn / maxV) * (EH / 2 - 8))
          p.endShape()
        }

        // Current time marker
        const markerX = EX + ((tMs % (cm || CYCLE_MS)) / (cm || CYCLE_MS)) * EW
        p.stroke(250, 250, 250, 130)
        p.strokeWeight(1)
        p.drawingContext.setLineDash([3, 3])
        p.line(markerX, EY, markerX, EY + EH)
        p.drawingContext.setLineDash([])

        // T-wave annotation
        p.noStroke()
        p.fill(103, 232, 249)
        p.textSize(7)
        p.textAlign(p.CENTER)
        p.text('T wave: repol travels epi→endo', EX + EW / 2, EY + EH + 18)
        p.text('→ same polarity as QRS in Lead I/II', EX + EW / 2, EY + EH + 28)

        // Time readout
        p.fill(75, 85, 99)
        p.textSize(7)
        p.textAlign(p.LEFT)
        p.text(`t = ${Math.round(tMs)} ms`, EX, H - 8)
      }
    }

    const container = containerRef.current
    if (!container) return
    let inst
    const rafId = requestAnimationFrame(() => {
      if (!container.isConnected) return
      while (container.firstChild) container.removeChild(container.firstChild)
      inst = new p5(sketch, container)
      p5InstRef.current = inst
    })
    return () => {
      cancelAnimationFrame(rafId)
      p5InstRef.current = null
      if (inst) { try { inst.remove() } catch (_) {} }
      while (container.firstChild) container.removeChild(container.firstChild)
    }
  }, [])  // mount once — data comes in via dataRef + redraw()

  return (
    <CanvasWrap containerRef={containerRef}>
      <SimBar>
        <span>Left: cardiac vector rotating through P-QRS-T · Right: Lead II strip with current position marker · synchronized with master clock</span>
      </SimBar>
    </CanvasWrap>
  )
}

// ── Main export ────────────────────────────────────────────────────────────
export default function CardiacBridge() {
  const rhythm = useMemo(() => {
    try {
      return buildRhythmFromParams(DEFAULT_RHYTHM_PARAMS)
    } catch {
      return { waves: [], cycleMs: CYCLE_MS, nativeCycleMs: null }
    }
  }, [])

  const conductionMap = useMemo(
    () => buildConductionMap('normalSinus', rhythm.waves),
    [rhythm.waves]
  )

  const masterClockRef = useRef({ tInCycle: 0, cycleMs: CYCLE_MS, nativeCycleMs: null, elapsedMs: 0 })
  const [masterTimeMs, setMasterTimeMs] = useState(0)
  const isPlayingRef = useRef(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const [speedMult, setSpeedMult] = useState(1)
  const speedMultRef = useRef(1)
  const handleSpeedChange = useCallback((s) => { speedMultRef.current = s; setSpeedMult(s) }, [])

  useEffect(() => {
    let lastTs = null, raf
    const tick = (ts) => {
      if (isPlayingRef.current && lastTs !== null) {
        const dt = Math.min(ts - lastTs, 50) * speedMultRef.current
        const cm = rhythm.cycleMs || CYCLE_MS
        const newT = (masterClockRef.current.tInCycle + dt) % cm
        masterClockRef.current.tInCycle = newT
        masterClockRef.current.cycleMs = cm
        masterClockRef.current.elapsedMs = (masterClockRef.current.elapsedMs || 0) + dt
        setMasterTimeMs(Math.round(newT))
      }
      lastTs = ts
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [rhythm.cycleMs])

  const togglePlay = useCallback(() => {
    isPlayingRef.current = !isPlayingRef.current
    setIsPlaying(v => !v)
  }, [])

  const handleScrub = useCallback((ms) => {
    masterClockRef.current.tInCycle = ms
    setMasterTimeMs(ms)
  }, [])

  const handleStep = useCallback(() => {
    const cm = rhythm.cycleMs || CYCLE_MS
    const newT = (masterClockRef.current.tInCycle + 10) % cm
    masterClockRef.current.tInCycle = newT
    setMasterTimeMs(Math.round(newT))
  }, [rhythm.cycleMs])

  const [selected2A, setSelected2A] = useState(null)
  const apHighlight = selected2A ? (ANATOMY[selected2A]?.apType ?? null) : null

  return (
    <ModulePage
      moduleId="cardiac"
      number={2}
      title="Cardiac electrophysiology"
      objective="Every wave in an ECG corresponds to depolarization or repolarization of a specific anatomical structure. When that structure fails, the wave changes in a predictable way you can reason through — not just recognize."
      description="This module walks through the heart's electrical system from first principles. Watch the SA node fire, depolarization spread through the atria, slow at the AV node, accelerate through the His-Purkinje system, and sweep through the ventricular myocardium. Each anatomical stage maps directly to a feature of the ECG trace."
    >
      <Section
        label="2A"
        title="Heart Anatomy Overview"
        subtitle="Hover or click any structure to see its primary function, electrical behavior, and ECG correlation. A click in 2A will highlight the corresponding action potential in 2B."
      >
        <AnatomyDiagram selected={selected2A} onSelect={setSelected2A} />
        <Callout>
          The SA node is the heart's primary pacemaker — it fires spontaneously without any external trigger.
          The AV node imposes a deliberate 120–200 ms delay (the PR segment) that allows ventricular filling
          before systole. The His-Purkinje system then accelerates conduction to near-simultaneous ventricular
          activation, producing the narrow (&lt;100 ms) QRS complex.
        </Callout>
      </Section>

      <Section
        label="2B"
        title="Action Potentials by Cell Type"
        subtitle="Three fundamentally different action potential shapes — each explained by different ion channel composition. Hover any phase region to see which channels are open and what they do."
      >
        <ActionPotentials selectedKey={apHighlight} />
        <Callout>
          SA node and AV node use <strong>slow-response</strong> action potentials (ICa-L upstroke, ~0.05 m/s).
          Atrial and ventricular myocytes use <strong>fast-response</strong> (INa upstroke, 1 m/s).
          Purkinje fibers have the fastest upstroke (highest dV/dt), longest plateau, and act as tertiary
          pacemakers (20–40 bpm) if SA and AV nodes both fail.
        </Callout>
      </Section>

      <Section
        label="2C"
        title="Conduction Animation"
        subtitle="Watch depolarization propagate through the conduction system in real time. Use the scrubber to move to any point in the cardiac cycle."
      >
        <ConductionSection
          clockRef={masterClockRef}
          rhythm={rhythm}
          conductionMap={conductionMap}
          masterTimeMs={masterTimeMs}
          isPlaying={isPlaying}
          onToggle={togglePlay}
          onScrub={handleScrub}
          onStep={handleStep}
          speedMult={speedMult}
          onSpeedChange={handleSpeedChange}
        />
        <Callout>
          The AV node is the rate-limiting step at 0.05 m/s — 20× slower than atrial muscle.
          Once past the AV node, the His-Purkinje system accelerates conduction 40–80× faster than myocardium,
          delivering simultaneous endocardial activation across both ventricles.
        </Callout>
      </Section>

      <Section
        label="2D"
        title="From Wavefront to Cardiac Dipole"
        subtitle="The boundary between depolarized (blue) and resting tissue creates a dipole vector — identical to the dipole model from Module 1. The green arrow is the net cardiac vector at each moment."
      >
        <WavefrontDipole
          clockRef={masterClockRef}
          waves={rhythm.waves}
          cycleMs={rhythm.cycleMs}
          conductionMap={conductionMap}
          currentTimeMs={masterTimeMs}
        />
        <Callout>
          During QRS, the depolarization wavefront sweeps left and inferiorly (toward the dominant LV mass).
          This is why the normal axis is +60°. During repolarization (T wave), the wave travels
          epicardium→endocardium (opposite to depolarization), but still produces the same polarity deflection
          in most leads because the gradient is reversed.
        </Callout>
      </Section>

      <Section
        label="2E"
        title="Cardiac Vector Cycle"
        subtitle="The cardiac vector rotates through different angles during P, QRS, and T. The projection onto each lead axis determines that lead's deflection — positive projection → upward deflection."
      >
        <VectorCycle
          clockRef={masterClockRef}
          waves={rhythm.waves}
          cycleMs={rhythm.cycleMs}
          currentTimeMs={masterTimeMs}
        />
        <Callout>
          Lead II (60°) is aligned with the normal axis and shows the tallest P wave and R wave.
          Lead I (0°) projects the leftward component. aVR (−150°) is always negative in a normal heart
          because the main QRS vector points away from it. The T wave in most leads has the same polarity
          as the QRS because repolarization proceeds epicardium→endocardium (the same net direction).
        </Callout>
      </Section>
    </ModulePage>
  )
}
