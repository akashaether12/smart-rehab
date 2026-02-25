import {
  FilesetResolver,
  HandLandmarker,
  PoseLandmarker,
} from '@mediapipe/tasks-vision'
import {
  addDoc,
  collection,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore'
import { onValue, ref, remove, set } from 'firebase/database'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import useAuth from '../auth/useAuth'
import { db, rtdb } from '../firebase'
import { EXERCISES, evaluateFrame } from '../exercises'
import type { ExerciseConfig, ExerciseId } from '../exercises'
import type { AppointmentRecord, SessionRecord } from '../types'

type DashboardTab = 'overview' | 'exercises' | 'appointments' | 'progress'

const toNumber = (value: unknown, fallback = 0) =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback

const toMillis = (value: unknown) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (
    value &&
    typeof value === 'object' &&
    'toMillis' in value &&
    typeof (value as { toMillis?: unknown }).toMillis === 'function'
  ) {
    return (value as { toMillis: () => number }).toMillis()
  }
  return 0
}

const mapSession = (
  id: string,
  data: Record<string, unknown>,
  clinicFallback: string,
  patientFallback: string,
): SessionRecord => {
  const resolvedTimestamp = toMillis(data.timestamp) || toNumber(data.clientTimestamp)
  return {
  id,
  exerciseId: String(data.exerciseId ?? ''),
  duration: toNumber(data.duration),
  repetitionCount: toNumber(data.repetitionCount),
  accuracyScore: toNumber(data.accuracyScore),
  finalScore: toNumber(data.finalScore),
  speed: toNumber(data.speed),
  stability: toNumber(data.stability),
  formScore: toNumber(data.formScore),
  qualityAvg: toNumber(data.qualityAvg),
  timestamp: resolvedTimestamp,
  clinicId: String(data.clinicId ?? clinicFallback),
  doctorId: String(data.doctorId ?? ''),
  patientId: String(data.patientId ?? patientFallback),
}
}

const mapAppointment = (
  id: string,
  data: Record<string, unknown>,
  clinicFallback: string,
  patientFallback: string,
): AppointmentRecord => ({
  id,
  patientId: String(data.patientId ?? patientFallback),
  clinicId: String(data.clinicId ?? clinicFallback),
  startsAt: toMillis(data.startsAt),
  mode: data.mode === 'in-clinic' ? 'in-clinic' : 'virtual',
  notes: String(data.notes ?? ''),
  status:
    data.status === 'completed' || data.status === 'cancelled'
      ? data.status
      : 'scheduled',
  createdAt: toMillis(data.createdAt),
})

function PatientPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const inSession = location.pathname.endsWith('/session')

  const { user, clinicId, logout } = useAuth()

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const requestRef = useRef<number | null>(null)
  const landmarkerRef = useRef<PoseLandmarker | null>(null)
  const handRef = useRef<HandLandmarker | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const repRef = useRef(0)
  const phaseRef = useRef('idle')
  const sumQualityRef = useRef(0)
  const frameCountRef = useRef(0)
  const startTimeRef = useRef<number | null>(null)

  const [activeTab, setActiveTab] = useState<DashboardTab>('overview')
  const [exercise, setExercise] = useState<ExerciseId>('head')
  const [initialised, setInitialised] = useState(false)
  const [initialising, setInitialising] = useState(false)
  const [setupAttempt, setSetupAttempt] = useState(0)
  const [paused, setPaused] = useState(false)
  const [repCount, setRepCount] = useState(0)
  const [quality, setQuality] = useState(0)
  const [status, setStatus] = useState('Select an exercise to begin.')
  const [savingSession, setSavingSession] = useState(false)

  const [sessionHistory, setSessionHistory] = useState<SessionRecord[]>([])
  const [appointments, setAppointments] = useState<AppointmentRecord[]>([])
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [loadingAppointments, setLoadingAppointments] = useState(false)

  const [appointmentDate, setAppointmentDate] = useState('')
  const [appointmentMode, setAppointmentMode] = useState<'virtual' | 'in-clinic'>(
    'virtual',
  )
  const [appointmentNotes, setAppointmentNotes] = useState('')
  const [savingAppointment, setSavingAppointment] = useState(false)

  const [expandedExercise, setExpandedExercise] = useState<ExerciseId | null>(null)
  const [planChecklist, setPlanChecklist] = useState<Record<string, boolean>>({
    warmup: false,
    breathing: false,
    mobility: false,
    notes: false,
  })

  const config = useMemo<ExerciseConfig>(
    () => EXERCISES.find((item) => item.id === exercise) ?? EXERCISES[0],
    [exercise],
  )

  const clearLiveSession = useCallback(async () => {
    if (!user || !clinicId) return
    try {
      await remove(ref(rtdb, `liveSessions/${clinicId}/${user.uid}`))
    } catch (err) {
      console.error(err)
    }
  }, [user, clinicId])

  const resetCounters = useCallback(() => {
    setRepCount(0)
    repRef.current = 0
    phaseRef.current = 'idle'
    sumQualityRef.current = 0
    frameCountRef.current = 0
    startTimeRef.current = Date.now()
  }, [])

  const stopVideo = useCallback(
    (clearLive = true) => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current)
      requestRef.current = null

      const stream = streamRef.current || (videoRef.current?.srcObject as MediaStream | null)
      stream?.getTracks().forEach((track) => track.stop())
      if (videoRef.current) videoRef.current.srcObject = null

      streamRef.current = null
      landmarkerRef.current = null
      handRef.current = null
      setInitialised(false)
      setInitialising(false)

      if (clearLive) clearLiveSession().catch(console.error)
    },
    [clearLiveSession],
  )

  const openSession = (exerciseId: ExerciseId) => {
    setExercise(exerciseId)
    navigate(`/patient/session?ex=${exerciseId}`)
  }

  const backToDashboard = () => {
    stopVideo()
    setSearchParams({})
    navigate('/patient', { replace: true })
  }

  const loadHistory = useCallback(async () => {
    if (!user || !clinicId) return
    setLoadingHistory(true)
    try {
      const historyQuery = query(
        collection(db, 'sessions'),
        where('patientId', '==', user.uid),
        limit(80),
      )
      const snapshot = await getDocs(historyQuery)
      const rows: SessionRecord[] = []
      snapshot.forEach((row) => {
        rows.push(mapSession(row.id, row.data() as Record<string, unknown>, clinicId, user.uid))
      })
      rows.sort((a, b) => b.timestamp - a.timestamp)
      setSessionHistory(rows)
    } catch (err) {
      console.error(err)
    } finally {
      setLoadingHistory(false)
    }
  }, [user, clinicId])

  const loadAppointments = useCallback(async () => {
    if (!user || !clinicId) return
    setLoadingAppointments(true)
    try {
      const appointmentQuery = query(
        collection(db, 'appointments'),
        where('patientId', '==', user.uid),
        orderBy('startsAt', 'asc'),
        limit(40),
      )
      const snapshot = await getDocs(appointmentQuery)
      const rows: AppointmentRecord[] = []
      snapshot.forEach((row) => {
        rows.push(
          mapAppointment(row.id, row.data() as Record<string, unknown>, clinicId, user.uid),
        )
      })
      setAppointments(rows)
    } catch (err) {
      console.error(err)
    } finally {
      setLoadingAppointments(false)
    }
  }, [user, clinicId])

  useEffect(() => {
    const ex = searchParams.get('ex') as ExerciseId | null
    if (ex && EXERCISES.some((item) => item.id === ex)) {
      setExercise(ex)
    }
  }, [searchParams])

  useEffect(() => {
    loadHistory().catch(console.error)
    loadAppointments().catch(console.error)
  }, [loadHistory, loadAppointments])

  useEffect(() => {
    if (!inSession) {
      stopVideo()
      return
    }
    resetCounters()
    setPaused(false)
    setQuality(0)
    setStatus('Preparing camera...')
  }, [inSession, exercise, resetCounters, stopVideo])

  useEffect(() => {
    if (!inSession || initialised || initialising) return

    let cancelled = false
    const setup = async () => {
      setInitialising(true)
      try {
        const videoEl = videoRef.current
        if (!videoEl) return

        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user' },
        })
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }

        videoEl.srcObject = stream
        streamRef.current = stream

        if (videoEl.readyState < 1) {
          await new Promise<void>((resolve) => {
            videoEl.addEventListener('loadedmetadata', () => resolve(), {
              once: true,
            })
          })
        }
        await videoEl.play()

        const fileset = await FilesetResolver.forVisionTasks(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32/wasm',
        )

        landmarkerRef.current = await PoseLandmarker.createFromOptions(fileset, {
          baseOptions: {
            modelAssetPath:
              'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task',
          },
          runningMode: 'VIDEO',
          numPoses: 1,
        })

        handRef.current = await HandLandmarker.createFromOptions(fileset, {
          baseOptions: {
            modelAssetPath:
              'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
          },
          runningMode: 'VIDEO',
          numHands: 1,
        })

        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }
        setInitialised(true)
        setStatus('Camera ready. Start moving.')
      } catch (err) {
        console.error(err)
        setStatus('Camera or AI setup failed. Retry and allow camera access.')
      } finally {
        if (!cancelled) setInitialising(false)
      }
    }

    setup().catch(console.error)
    return () => {
      cancelled = true
    }
  }, [inSession, initialised, setupAttempt])

  useEffect(() => {
    return () => {
      stopVideo()
    }
  }, [stopVideo])

  useEffect(() => {
    if (!inSession || !initialised || !videoRef.current || !landmarkerRef.current) return

    const processFrame = () => {
      if (!inSession) return

      if (paused) {
        requestRef.current = requestAnimationFrame(processFrame)
        return
      }

      const video = videoRef.current
      if (!video || video.readyState < 2 || video.videoWidth === 0) {
        requestRef.current = requestAnimationFrame(processFrame)
        return
      }

      const now = performance.now()
      const pose = landmarkerRef.current?.detectForVideo(video, now) ?? null
      const hand = handRef.current?.detectForVideo(video, now) ?? null

      const result = evaluateFrame(exercise, pose, hand, {
        rep: repRef.current,
        phase: phaseRef.current,
      })

      if (result.rep !== repRef.current) {
        repRef.current = result.rep
        setRepCount(result.rep)
      }
      if (result.phase && result.phase !== phaseRef.current) {
        phaseRef.current = result.phase
      }

      const safeQuality = Math.max(0, Math.min(100, result.quality || 0))
      setStatus(result.status)
      setQuality(safeQuality)
      sumQualityRef.current += safeQuality
      frameCountRef.current += 1

      if (user && clinicId) {
        const elapsedSeconds = startTimeRef.current
          ? (Date.now() - startTimeRef.current) / 1000
          : 0
        const speed = elapsedSeconds > 0 ? (repRef.current / elapsedSeconds) * 60 : 0
        const stability = Math.max(0, Math.min(100, 100 - Math.abs(safeQuality - 80)))
        const formScore = safeQuality * 0.6 + stability * 0.4

        set(ref(rtdb, `liveSessions/${clinicId}/${user.uid}`), {
          repCount: repRef.current,
          quality: safeQuality,
          progress: Math.min(100, (repRef.current / config.targetReps) * 100),
          updatedAt: Date.now(),
          exerciseId: exercise,
          patientId: user.uid,
          status: result.status,
          accuracy: safeQuality,
          speed: Number(speed.toFixed(1)),
          stability: Number(stability.toFixed(1)),
          formScore: Number(formScore.toFixed(1)),
        }).catch(console.error)
      }

      requestRef.current = requestAnimationFrame(processFrame)
    }

    requestRef.current = requestAnimationFrame(processFrame)
    return () => {
      if (requestRef.current) {
        cancelAnimationFrame(requestRef.current)
        requestRef.current = null
      }
    }
  }, [inSession, initialised, paused, exercise, user, clinicId, config.targetReps])

  const saveSession = async () => {
    if (!user || !clinicId) return

    setSavingSession(true)
    try {
      const elapsedSeconds = startTimeRef.current
        ? (Date.now() - startTimeRef.current) / 1000
        : 0
      const avgQuality =
        frameCountRef.current > 0
          ? sumQualityRef.current / frameCountRef.current
          : 0
      const clientTimestamp = Date.now()
      const speed =
        repRef.current > 0 && elapsedSeconds > 0 ? (repRef.current / elapsedSeconds) * 60 : 0
      const stability = Math.min(100, Math.max(0, 100 - Math.abs(avgQuality - 80)))
      const formScore = Math.min(100, avgQuality * 0.6 + 80 * 0.4)
      const finalScore = Math.min(
        100,
        (repRef.current / config.targetReps) * 50 + Math.min(100, avgQuality) * 0.5,
      )

      await addDoc(collection(db, 'sessions'), {
        exerciseId: exercise,
        duration: elapsedSeconds,
        repetitionCount: repRef.current,
        accuracyScore: Math.min(100, avgQuality),
        finalScore,
        speed,
        stability,
        formScore,
        qualityAvg: avgQuality,
        timestamp: serverTimestamp(),
        clientTimestamp,
        clinicId,
        doctorId: '',
        patientId: user.uid,
      })

      setSessionHistory((prev) =>
        [
          {
            id: `local-${clientTimestamp}`,
            exerciseId: exercise,
            duration: elapsedSeconds,
            repetitionCount: repRef.current,
            accuracyScore: Math.min(100, avgQuality),
            finalScore,
            speed,
            stability,
            formScore,
            qualityAvg: avgQuality,
            timestamp: clientTimestamp,
            clinicId,
            doctorId: '',
            patientId: user.uid,
          },
          ...prev,
        ].sort((a, b) => b.timestamp - a.timestamp),
      )

      setStatus('Session saved to your history.')
      resetCounters()
      await loadHistory()
    } catch (err) {
      console.error(err)
      setStatus('Failed to save session. Please try again.')
    } finally {
      setSavingSession(false)
    }
  }

  const createAppointment = async () => {
    if (!user || !clinicId) return
    if (!appointmentDate) {
      setStatus('Choose an appointment date and time first.')
      return
    }

    const startsAt = new Date(appointmentDate).getTime()
    if (!Number.isFinite(startsAt)) {
      setStatus('Appointment date is invalid.')
      return
    }

    setSavingAppointment(true)
    try {
      await addDoc(collection(db, 'appointments'), {
        patientId: user.uid,
        clinicId,
        startsAt,
        mode: appointmentMode,
        notes: appointmentNotes.trim(),
        status: 'scheduled',
        createdAt: serverTimestamp(),
      })
      setAppointmentDate('')
      setAppointmentNotes('')
      await loadAppointments()
    } catch (err) {
      console.error(err)
      setStatus('Failed to create appointment.')
    } finally {
      setSavingAppointment(false)
    }
  }

  const updateAppointmentStatus = async (
    appointmentId: string,
    nextStatus: 'completed' | 'cancelled',
  ) => {
    try {
      await updateDoc(doc(db, 'appointments', appointmentId), { status: nextStatus })
      setAppointments((prev) =>
        prev.map((item) =>
          item.id === appointmentId ? { ...item, status: nextStatus } : item,
        ),
      )
    } catch (err) {
      console.error(err)
      setStatus('Failed to update appointment status.')
    }
  }

  const sessionMetrics = useMemo(() => {
    if (!sessionHistory.length) {
      return {
        totalSessions: 0,
        totalScore: 0,
        avgAccuracy: 0,
        totalMinutes: 0,
      }
    }
    const totalScore = sessionHistory.reduce((sum, row) => sum + row.finalScore, 0)
    const avgAccuracy =
      sessionHistory.reduce((sum, row) => sum + row.accuracyScore, 0) /
      sessionHistory.length
    const totalMinutes =
      sessionHistory.reduce((sum, row) => sum + row.duration, 0) / 60

    return {
      totalSessions: sessionHistory.length,
      totalScore,
      avgAccuracy,
      totalMinutes,
    }
  }, [sessionHistory])

  const latestByExercise = useMemo(() => {
    const map = new Map<ExerciseId, SessionRecord>()
    sessionHistory.forEach((row) => {
      const key = row.exerciseId as ExerciseId
      if (!EXERCISES.some((item) => item.id === key)) return
      const current = map.get(key)
      if (!current || row.timestamp > current.timestamp) {
        map.set(key, row)
      }
    })
    return map
  }, [sessionHistory])

  const progressData = useMemo(
    () =>
      sessionHistory
        .slice()
        .sort((a, b) => a.timestamp - b.timestamp)
        .slice(-14)
        .map((entry) => ({
          label: new Date(entry.timestamp).toLocaleDateString([], {
            month: 'short',
            day: 'numeric',
          }),
          score: Number(entry.finalScore.toFixed(0)),
          accuracy: Number(entry.accuracyScore.toFixed(0)),
        })),
    [sessionHistory],
  )

  const nextAppointment = useMemo(() => {
    const now = Date.now()
    return appointments.find(
      (item) => item.status === 'scheduled' && item.startsAt >= now,
    )
  }, [appointments])

  const minutesElapsed = startTimeRef.current
    ? (Date.now() - startTimeRef.current) / 60000
    : 0
  const liveSpeed = minutesElapsed > 0 ? repCount / minutesElapsed : 0
  const progressPercent = Math.min(100, (repCount / config.targetReps) * 100)

  if (!inSession) {
    return (
      <div className="patient-shell">
        <aside className="nav-rail">
          <div className="brand-block">
            <img src="/images/hero-rehab.svg" alt="Rehab app" className="rail-logo" />
            <div>
              <div className="brand">RehabFlow</div>
              <p className="muted small">AI-assisted recovery</p>
            </div>
          </div>

          <nav className="stack-sm">
            <button
              className={activeTab === 'overview' ? 'nav-item active' : 'nav-item'}
              onClick={() => setActiveTab('overview')}
            >
              Overview
            </button>
            <button
              className={activeTab === 'exercises' ? 'nav-item active' : 'nav-item'}
              onClick={() => setActiveTab('exercises')}
            >
              Exercises
            </button>
            <button
              className={activeTab === 'appointments' ? 'nav-item active' : 'nav-item'}
              onClick={() => setActiveTab('appointments')}
            >
              Appointments
            </button>
            <button
              className={activeTab === 'progress' ? 'nav-item active' : 'nav-item'}
              onClick={() => setActiveTab('progress')}
            >
              Progress
            </button>
          </nav>

          <div className="nav-footer">
            <span className="muted small">{user?.email}</span>
            <button onClick={logout}>Sign out</button>
          </div>
        </aside>

        <main className="patient-main">
          <header className="dash-header">
            <div>
              <h1>Welcome, {user?.email?.split('@')[0] || 'Patient'}</h1>
              <p className="muted">Clinic {clinicId || '-'} - your rehabilitation workspace</p>
            </div>
            <button className="primary" onClick={() => openSession(exercise)}>
              Resume {config.name}
            </button>
          </header>

          {activeTab === 'overview' && (
            <section className="stack-lg" style={{ marginTop: 16 }}>
              <div className="hero-card">
                <img
                  src="/images/hero-rehab.svg"
                  alt="Patient rehabilitation session"
                  className="hero-image"
                />
                <div className="stack-sm">
                  <h3>Today plan</h3>
                  <p className="muted">
                    Keep sessions short and high quality. Your next scheduled check-in:
                  </p>
                  <strong>
                    {nextAppointment
                      ? new Date(nextAppointment.startsAt).toLocaleString([], {
                          month: 'short',
                          day: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                        })
                      : 'No appointment yet'}
                  </strong>
                  <div className="actions">
                    <button
                      className={planChecklist.warmup ? 'primary' : 'secondary'}
                      onClick={() =>
                        setPlanChecklist((prev) => ({ ...prev, warmup: !prev.warmup }))
                      }
                    >
                      Warm-up done
                    </button>
                    <button
                      className={planChecklist.breathing ? 'primary' : 'secondary'}
                      onClick={() =>
                        setPlanChecklist((prev) => ({ ...prev, breathing: !prev.breathing }))
                      }
                    >
                      Breathing done
                    </button>
                    <button
                      className={planChecklist.mobility ? 'primary' : 'secondary'}
                      onClick={() =>
                        setPlanChecklist((prev) => ({ ...prev, mobility: !prev.mobility }))
                      }
                    >
                      Mobility done
                    </button>
                    <button
                      className={planChecklist.notes ? 'primary' : 'secondary'}
                      onClick={() =>
                        setPlanChecklist((prev) => ({ ...prev, notes: !prev.notes }))
                      }
                    >
                      Notes done
                    </button>
                  </div>
                </div>
              </div>

              <div className="metrics-grid">
                <div className="metric-card">
                  <p className="muted">Total sessions</p>
                  <h2>{sessionMetrics.totalSessions}</h2>
                </div>
                <div className="metric-card">
                  <p className="muted">Total score</p>
                  <h2>{sessionMetrics.totalScore.toFixed(0)}</h2>
                </div>
                <div className="metric-card">
                  <p className="muted">Average accuracy</p>
                  <h2>
                    {sessionMetrics.totalSessions
                      ? `${sessionMetrics.avgAccuracy.toFixed(0)}%`
                      : '--'}
                  </h2>
                </div>
                <div className="metric-card">
                  <p className="muted">Total training time</p>
                  <h2>{sessionMetrics.totalMinutes.toFixed(0)} min</h2>
                </div>
              </div>
            </section>
          )}

          {activeTab === 'exercises' && (
            <section style={{ marginTop: 16 }}>
              <div className="section-header">
                <h3>Exercise library</h3>
                <span className="muted">Select a card to start a guided camera session</span>
              </div>
              <div className="exercise-grid">
                {EXERCISES.map((item) => {
                  const latest = latestByExercise.get(item.id)
                  return (
                    <article key={item.id} className="exercise-card">
                      <img src={item.image} alt={`${item.name} visual`} className="exercise-image" />
                      <div className="exercise-header">
                        <h4>{item.name}</h4>
                        <span className="badge">{item.difficulty}</span>
                      </div>
                      <p className="muted">{item.focusArea}</p>
                      <div className="subgrid">
                        <div>
                          <p className="muted">Last score</p>
                          <strong>{latest ? latest.finalScore.toFixed(0) : '--'}</strong>
                        </div>
                        <div>
                          <p className="muted">Last accuracy</p>
                          <strong>{latest ? `${latest.accuracyScore.toFixed(0)}%` : '--'}</strong>
                        </div>
                        <div>
                          <p className="muted">Target reps</p>
                          <strong>{item.targetReps}</strong>
                        </div>
                      </div>
                      <div className="actions">
                        <button className="primary" onClick={() => openSession(item.id)}>
                          Start session
                        </button>
                        <button
                          className="secondary"
                          onClick={() =>
                            setExpandedExercise((prev) =>
                              prev === item.id ? null : item.id,
                            )
                          }
                        >
                          {expandedExercise === item.id ? 'Hide steps' : 'View steps'}
                        </button>
                      </div>
                      {expandedExercise === item.id && (
                        <ol className="steps">
                          {item.instructions.map((step) => (
                            <li key={step}>{step}</li>
                          ))}
                        </ol>
                      )}
                    </article>
                  )
                })}
              </div>
            </section>
          )}

          {activeTab === 'appointments' && (
            <section className="stack-lg" style={{ marginTop: 16 }}>
              <div className="card-lg">
                <div className="section-header">
                  <h3>Request appointment</h3>
                  <span className="muted">Create a therapist follow-up request</span>
                </div>
                <div className="toolbar-row">
                  <label className="field grow">
                    <span>Date and time</span>
                    <input
                      type="datetime-local"
                      value={appointmentDate}
                      onChange={(event) => setAppointmentDate(event.target.value)}
                    />
                  </label>
                  <label className="field">
                    <span>Mode</span>
                    <select
                      value={appointmentMode}
                      onChange={(event) =>
                        setAppointmentMode(event.target.value as 'virtual' | 'in-clinic')
                      }
                    >
                      <option value="virtual">Virtual</option>
                      <option value="in-clinic">In-clinic</option>
                    </select>
                  </label>
                </div>
                <label className="field" style={{ marginTop: 12 }}>
                  <span>Notes</span>
                  <input
                    value={appointmentNotes}
                    onChange={(event) => setAppointmentNotes(event.target.value)}
                    placeholder="Symptoms, progress concerns, or preferred slots"
                  />
                </label>
                <div className="actions">
                  <button
                    className="primary"
                    onClick={createAppointment}
                    disabled={savingAppointment}
                  >
                    {savingAppointment ? 'Submitting...' : 'Create appointment'}
                  </button>
                </div>
              </div>

              <div className="card-lg">
                <div className="section-header">
                  <h3>Scheduled appointments</h3>
                  <span className="muted">Track and update status</span>
                </div>
                {loadingAppointments ? (
                  <p className="muted">Loading appointments...</p>
                ) : appointments.length === 0 ? (
                  <p className="muted">No appointments yet.</p>
                ) : (
                  <div className="appointment-list">
                    {appointments.map((item) => (
                      <article key={item.id} className="appointment-item">
                        <div>
                          <h4>
                            {new Date(item.startsAt).toLocaleString([], {
                              month: 'short',
                              day: '2-digit',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </h4>
                          <p className="muted">
                            {item.mode === 'virtual' ? 'Virtual' : 'In-clinic'} -{' '}
                            {item.notes || 'No notes'}
                          </p>
                        </div>
                        <div className="actions">
                          <span className={`status-chip status-${item.status}`}>
                            {item.status}
                          </span>
                          {item.status === 'scheduled' && (
                            <>
                              <button
                                className="secondary"
                                onClick={() => updateAppointmentStatus(item.id, 'completed')}
                              >
                                Mark completed
                              </button>
                              <button
                                className="secondary"
                                onClick={() => updateAppointmentStatus(item.id, 'cancelled')}
                              >
                                Cancel
                              </button>
                            </>
                          )}
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </div>
            </section>
          )}

          {activeTab === 'progress' && (
            <section className="stack-lg" style={{ marginTop: 16 }}>
              <div className="card-lg">
                <div className="section-header">
                  <h3>Progress trend</h3>
                  <span className="muted">Last 14 saved sessions</span>
                </div>
                {loadingHistory ? (
                  <p className="muted">Loading progress...</p>
                ) : progressData.length === 0 ? (
                  <p className="muted">Progress chart appears after your first saved session.</p>
                ) : (
                  <div style={{ height: 280 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={progressData}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="label" />
                        <YAxis domain={[0, 100]} />
                        <Tooltip />
                        <Line
                          type="monotone"
                          dataKey="score"
                          stroke="#0ea5a3"
                          strokeWidth={2}
                          dot={false}
                        />
                        <Line
                          type="monotone"
                          dataKey="accuracy"
                          stroke="#f97316"
                          strokeWidth={2}
                          dot={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>

              <div className="card-lg">
                <div className="section-header">
                  <h3>Recent sessions</h3>
                  <span className="muted">Newest first</span>
                </div>
                {sessionHistory.length === 0 ? (
                  <p className="muted">No saved sessions yet.</p>
                ) : (
                  <div className="session-table">
                    <div className="session-row header">
                      <span>Exercise</span>
                      <span>Reps</span>
                      <span>Accuracy</span>
                      <span>Score</span>
                      <span>Duration</span>
                      <span>Speed</span>
                      <span>Date</span>
                    </div>
                    {sessionHistory.slice(0, 20).map((entry) => (
                      <div key={entry.id ?? `${entry.exerciseId}-${entry.timestamp}`} className="session-row">
                        <span>{entry.exerciseId}</span>
                        <span>{entry.repetitionCount}</span>
                        <span>{entry.accuracyScore.toFixed(0)}%</span>
                        <span>{entry.finalScore.toFixed(0)}</span>
                        <span>{(entry.duration / 60).toFixed(1)} min</span>
                        <span>{(entry.speed ?? 0).toFixed(1)} rpm</span>
                        <span>
                          {new Date(entry.timestamp).toLocaleString([], {
                            month: 'short',
                            day: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>
          )}
        </main>
      </div>
    )
  }

  return (
    <div className="page">
      <header className="topbar">
        <div>
          <p className="eyebrow">Patient Session</p>
          <h2>{config.name}</h2>
        </div>
        <div className="topbar-actions">
          <button className="secondary" onClick={backToDashboard}>
            Back to dashboard
          </button>
          <span>{user?.email}</span>
          <button onClick={logout}>Sign out</button>
        </div>
      </header>

      <div className="grid two-col">
        <section className="card-lg">
          <div className="section-header">
            <h3>Exercise and camera</h3>
            <span className="muted">Live AI feedback streams to doctor dashboard</span>
          </div>

          <div className="chips">
            {EXERCISES.map((item) => (
              <button
                key={item.id}
                className={item.id === exercise ? 'chip active' : 'chip'}
                onClick={() => openSession(item.id)}
              >
                {item.name}
              </button>
            ))}
          </div>

          <video ref={videoRef} className="video" muted playsInline autoPlay />

          <div className="progress-wrap">
            <div className="progress-label">
              <span className="muted">Target progress</span>
              <strong>{progressPercent.toFixed(0)}%</strong>
            </div>
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${progressPercent}%` }} />
            </div>
          </div>

          <p className="muted">{status}</p>

          <div className="stat-row">
            <div className="stat">
              <p className="muted">Quality</p>
              <h3>{quality.toFixed(0)}%</h3>
            </div>
            <div className="stat">
              <p className="muted">Reps</p>
              <h3>{repCount}</h3>
            </div>
            <div className="stat">
              <p className="muted">Speed</p>
              <h3>{Number.isFinite(liveSpeed) ? liveSpeed.toFixed(1) : '0.0'} rpm</h3>
            </div>
          </div>

          <div className="actions">
            <button className="secondary" onClick={() => setPaused((prev) => !prev)}>
              {paused ? 'Resume tracking' : 'Pause tracking'}
            </button>
            <button
              className="secondary"
              onClick={() => {
                resetCounters()
                setQuality(0)
                setStatus('Counters reset.')
              }}
            >
              Reset counters
            </button>
            <button className="primary" onClick={saveSession} disabled={savingSession}>
              {savingSession ? 'Saving session...' : 'Save session'}
            </button>
          </div>

          {!initialised && (
            <div className="actions">
              <button
                className="secondary"
                onClick={() => {
                  stopVideo(false)
                  setStatus('Retrying camera setup...')
                  setSetupAttempt((prev) => prev + 1)
                }}
              >
                Retry camera setup
              </button>
            </div>
          )}
        </section>

        <section className="card-lg">
          <div className="section-header">
            <h3>Session guide</h3>
            <span className="badge">Target: {config.targetReps} reps</span>
          </div>
          <img src={config.image} alt={`${config.name} illustration`} className="exercise-image" />
          <p className="muted">{config.focusArea}</p>
          <ol className="steps">
            {config.instructions.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <LiveSessionWatch clinicId={clinicId} patientId={user?.uid ?? null} />
        </section>
      </div>
    </div>
  )
}

function LiveSessionWatch({
  clinicId,
  patientId,
}: {
  clinicId: string | null
  patientId: string | null
}) {
  const [streamStatus, setStreamStatus] = useState('Waiting for stream...')

  useEffect(() => {
    if (!clinicId || !patientId) return
    const liveRef = ref(rtdb, `liveSessions/${clinicId}/${patientId}`)
    const unsub = onValue(liveRef, (snap) => {
      setStreamStatus(snap.exists() ? 'Streaming to doctor dashboard.' : 'Stream is not active yet.')
    })
    return () => unsub()
  }, [clinicId, patientId])

  return <div className="callout">{streamStatus}</div>
}

export default PatientPage
