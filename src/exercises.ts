import type { HandLandmarkerResult, PoseLandmarkerResult } from '@mediapipe/tasks-vision'

export type ExerciseId = 'finger' | 'hand' | 'head' | 'leg' | 'shoulder'

export type ExerciseConfig = {
  id: ExerciseId
  name: string
  focusArea: string
  difficulty: 'Beginner' | 'Intermediate'
  image: string
  targetReps: number
  instructions: string[]
}

export const EXERCISES: ExerciseConfig[] = [
  {
    id: 'head',
    name: 'Head Turns',
    focusArea: 'Neck mobility and posture control',
    difficulty: 'Beginner',
    image: '/images/exercise-head.svg',
    targetReps: 10,
    instructions: [
      'Face the camera with shoulders visible.',
      'Turn head slowly right past about 70 deg while shoulders stay still.',
      'Then turn left past about 70 deg.',
      'One full right-to-left (or left-to-right) sweep counts as 1 rep.',
    ],
  },
  {
    id: 'finger',
    name: 'Finger Pinch',
    focusArea: 'Fine motor control and grip precision',
    difficulty: 'Beginner',
    image: '/images/exercise-finger.svg',
    targetReps: 15,
    instructions: [
      'Show one hand to the camera.',
      'Pinch thumb and index together firmly, then release fully.',
      'Keep hand centered and well lit.',
    ],
  },
  {
    id: 'hand',
    name: 'Open / Fist',
    focusArea: 'Hand opening range and coordination',
    difficulty: 'Beginner',
    image: '/images/exercise-hand.svg',
    targetReps: 12,
    instructions: [
      'Show one hand to the camera.',
      'Fully open your hand, then make a fist.',
      'Hold each shape for about 1 second to count.',
    ],
  },
  {
    id: 'leg',
    name: 'Knee Raise',
    focusArea: 'Hip flexion and lower-limb control',
    difficulty: 'Intermediate',
    image: '/images/exercise-leg.svg',
    targetReps: 12,
    instructions: [
      'Stand so your full body is visible.',
      'Raise left knee above hip line, return to neutral.',
      'Alternate legs if comfortable; move slowly and with control.',
    ],
  },
  {
    id: 'shoulder',
    name: 'Shoulder Raises',
    focusArea: 'Shoulder stability and upper-body activation',
    difficulty: 'Intermediate',
    image: '/images/exercise-shoulder.svg',
    targetReps: 12,
    instructions: [
      'Stand or sit upright facing the camera.',
      'Raise left shoulder (shrug) toward ear, return to neutral.',
      'Raise right shoulder toward ear, return to neutral.',
      'One left + right cycle counts as 1 rep.',
    ],
  },
]

const distance = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y)

const angleDeg = (
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number },
) => {
  const ab = { x: a.x - b.x, y: a.y - b.y }
  const cb = { x: c.x - b.x, y: c.y - b.y }
  const dot = ab.x * cb.x + ab.y * cb.y
  const magAb = Math.hypot(ab.x, ab.y)
  const magCb = Math.hypot(cb.x, cb.y)
  if (!magAb || !magCb) return 180
  const cos = Math.min(1, Math.max(-1, dot / (magAb * magCb)))
  return Math.acos(cos) * (180 / Math.PI)
}

export function evaluateFrame(
  exercise: ExerciseId,
  pose: PoseLandmarkerResult | null,
  hand: HandLandmarkerResult | null,
  state: { rep: number; phase: string },
): { rep: number; status: string; quality: number; phase?: string } {
  switch (exercise) {
    case 'head':
      return headLogic(pose, state)
    case 'finger':
      return fingerLogic(hand, state)
    case 'hand':
      return handLogic(hand, state)
    case 'leg':
      return legLogic(pose, state)
    case 'shoulder':
      return shoulderLogic(pose, state)
    default:
      return { rep: state.rep, status: 'Idle', quality: 0 }
  }
}

function headLogic(pose: PoseLandmarkerResult | null, state: { rep: number; phase: string }) {
  if (!pose?.landmarks?.length) {
    return { rep: state.rep, status: 'Show your shoulders and head', quality: 0 }
  }

  const lm = pose.landmarks[0]
  const nose = lm[0]
  const lShoulder = lm[11]
  const rShoulder = lm[12]
  const span = Math.abs(lShoulder.x - rShoulder.x)
  if (!span) return { rep: state.rep, status: 'Hold steady', quality: 0 }

  const center = (lShoulder.x + rShoulder.x) / 2
  const delta = nose.x - center
  const yaw = Math.asin(Math.max(-1, Math.min(1, delta / span))) * (180 / Math.PI)
  const threshold = 25

  let rep = state.rep
  let phase = state.phase

  if (yaw > threshold && phase !== 'right') {
    phase = 'right'
  } else if (yaw < -threshold && phase === 'right') {
    rep += 1
    phase = 'left'
  } else if (yaw < -threshold && phase !== 'left') {
    phase = 'left'
  } else if (yaw > threshold && phase === 'left') {
    rep += 1
    phase = 'right'
  }

  const quality = Math.min(100, Math.max(0, (Math.abs(yaw) / threshold) * 70))
  return {
    rep,
    status: `Yaw ${yaw.toFixed(1)} deg`,
    quality,
    phase,
  }
}

function fingerLogic(hand: HandLandmarkerResult | null, state: { rep: number; phase: string }) {
  if (!hand?.landmarks?.length) {
    return { rep: state.rep, status: 'Show your hand to the camera', quality: 0 }
  }

  const lm = hand.landmarks[0]
  const thumb = lm[4]
  const index = lm[8]
  const wrist = lm[0]
  const span = distance(thumb, wrist)
  const pinch = distance(thumb, index)
  const norm = pinch / (span || 0.1)

  let rep = state.rep
  let phase = state.phase
  if (norm < 0.25) phase = 'pinched'
  if (norm > 0.45 && phase === 'pinched') {
    rep += 1
    phase = 'released'
  }

  const quality = Math.max(0, Math.min(100, (0.45 - norm) * 200))
  return { rep, status: `Pinch gap ${(norm * 100).toFixed(0)}%`, quality, phase }
}

function handLogic(hand: HandLandmarkerResult | null, state: { rep: number; phase: string }) {
  if (!hand?.landmarks?.length) {
    return { rep: state.rep, status: 'Show your hand to the camera', quality: 0 }
  }

  const lm = hand.landmarks[0]
  const tips = [8, 12, 16, 20].map((i) => lm[i])
  const mcp = [5, 9, 13, 17].map((i) => lm[i])
  const extended = tips.filter((t, idx) => t.y < mcp[idx].y).length

  let rep = state.rep
  let phase = state.phase
  if (extended >= 3) phase = 'open'
  if (extended <= 1 && phase === 'open') {
    rep += 1
    phase = 'fist'
  }

  const quality = Math.min(100, extended * 25)
  return { rep, status: extended >= 3 ? 'Open' : 'Fist', quality, phase }
}

function legLogic(pose: PoseLandmarkerResult | null, state: { rep: number; phase: string }) {
  if (!pose?.landmarks?.length) {
    return { rep: state.rep, status: 'Show full body to camera', quality: 0 }
  }

  const lm = pose.landmarks[0]
  const knee = lm[25]
  const hip = lm[23]
  const ankle = lm[27]
  const raised = knee.y < hip.y - 0.05

  let rep = state.rep
  let phase = state.phase
  if (raised) phase = 'up'
  if (!raised && phase === 'up') {
    rep += 1
    phase = 'down'
  }

  const ang = angleDeg(hip, knee, ankle)
  const quality = Math.min(100, Math.max(0, (180 - ang) * 1.2))
  return { rep, status: raised ? 'Knee up' : 'Neutral', quality, phase }
}

function shoulderLogic(pose: PoseLandmarkerResult | null, state: { rep: number; phase: string }) {
  if (!pose?.landmarks?.length) {
    return { rep: state.rep, status: 'Show upper body', quality: 0 }
  }

  const lm = pose.landmarks[0]
  const lShoulder = lm[11]
  const rShoulder = lm[12]
  const lEar = lm[7]
  const rEar = lm[8]
  const span = Math.abs(rShoulder.x - lShoulder.x) + 0.0001

  const lRatio = Math.abs(lEar.y - lShoulder.y) / span
  const rRatio = Math.abs(rEar.y - rShoulder.y) / span
  const lAngle = (1 - lRatio) * 180
  const rAngle = (1 - rRatio) * 180

  const liftAngle = 60
  const relaxAngle = 40

  let rep = state.rep
  const phaseStr = typeof state.phase === 'string' ? state.phase : 'L0R0'
  let leftHold = phaseStr.includes('L1')
  let rightHold = phaseStr.includes('R1')

  if (!leftHold && lAngle >= liftAngle) {
    rep += 1
    leftHold = true
  } else if (leftHold && lAngle < relaxAngle) {
    leftHold = false
  }

  if (!rightHold && rAngle >= liftAngle) {
    rep += 1
    rightHold = true
  } else if (rightHold && rAngle < relaxAngle) {
    rightHold = false
  }

  const phase = `L${leftHold ? 1 : 0}R${rightHold ? 1 : 0}`
  const quality = Math.min(100, Math.max(lAngle, rAngle) / 1.2)

  return {
    rep,
    status: `L:${lAngle.toFixed(0)} deg R:${rAngle.toFixed(0)} deg`,
    quality,
    phase,
  }
}
