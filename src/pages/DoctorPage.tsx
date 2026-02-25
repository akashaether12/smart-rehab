import { onValue, ref } from 'firebase/database'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  collection,
  doc,
  getDocs,
  limit,
  query,
  updateDoc,
  where,
} from 'firebase/firestore'
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import useAuth from '../auth/useAuth'
import { db, rtdb } from '../firebase'
import type { AppointmentRecord, LiveMetrics, SessionRecord } from '../types'

type LiveEntry = LiveMetrics & { id: string }

function DoctorPage() {
  const { user, clinicId, logout } = useAuth()

  const [live, setLive] = useState<LiveEntry[]>([])
  const [selectedPatient, setSelectedPatient] = useState<string | null>(null)
  const [recent, setRecent] = useState<SessionRecord[]>([])
  const [appointments, setAppointments] = useState<AppointmentRecord[]>([])
  const [loadingRecent, setLoadingRecent] = useState(false)
  const [loadingAppointments, setLoadingAppointments] = useState(false)
  const [updatingAppointmentId, setUpdatingAppointmentId] = useState<string | null>(null)
  const [rescheduleDrafts, setRescheduleDrafts] = useState<Record<string, string>>({})

  const [searchText, setSearchText] = useState('')
  const [exerciseFilter, setExerciseFilter] = useState('all')
  const [onlySelectedPatient, setOnlySelectedPatient] = useState(false)
  const [flagged, setFlagged] = useState<Record<string, boolean>>({})
  const [uidDraft, setUidDraft] = useState('')
  const [focusedPatientUid, setFocusedPatientUid] = useState<string | null>(null)

  useEffect(() => {
    if (!clinicId) return

    const sessionRef = ref(rtdb, `liveSessions/${clinicId}`)
    const unsub = onValue(sessionRef, (snap) => {
      const value = snap.val() as Record<string, LiveMetrics> | null
      if (!value) {
        setLive([])
        setSelectedPatient(null)
        return
      }

      const entries = Object.entries(value)
        .map(([id, payload]) => ({
          ...payload,
          id,
        }))
        .sort((a, b) => b.updatedAt - a.updatedAt)

      setLive(entries)
      setSelectedPatient((prev) => {
        if (prev && entries.some((item) => item.id === prev)) return prev
        return entries[0]?.id ?? null
      })
    })

    return () => unsub()
  }, [clinicId])

  const loadRecentSessions = useCallback(async () => {
    if (!clinicId) {
      setRecent([])
      return
    }

    setLoadingRecent(true)
    try {
      const q = query(
        collection(db, 'sessions'),
        where('clinicId', '==', clinicId),
        limit(50),
      )

      const snapshot = await getDocs(q)
      const rows: SessionRecord[] = []
      snapshot.forEach((doc) => {
        const data = doc.data() as Record<string, unknown>
        const timestampValue = data.timestamp as
          | { toMillis?: () => number }
          | number
          | undefined

        rows.push({
          id: doc.id,
          exerciseId: String(data.exerciseId ?? ''),
          duration: Number(data.duration ?? 0),
          repetitionCount: Number(data.repetitionCount ?? 0),
          accuracyScore: Number(data.accuracyScore ?? 0),
          finalScore: Number(data.finalScore ?? 0),
          speed: Number(data.speed ?? 0),
          stability: Number(data.stability ?? 0),
          formScore: Number(data.formScore ?? 0),
          qualityAvg: Number(data.qualityAvg ?? 0),
          timestamp:
            typeof timestampValue === 'number'
              ? timestampValue
              : timestampValue?.toMillis?.() ?? 0,
          clinicId: String(data.clinicId ?? clinicId),
          doctorId: String(data.doctorId ?? ''),
          patientId: String(data.patientId ?? ''),
        })
      })

      rows.sort((a, b) => b.timestamp - a.timestamp)
      setRecent(rows)
    } catch (err) {
      console.error(err)
    } finally {
      setLoadingRecent(false)
    }
  }, [clinicId])

  const loadAppointments = useCallback(async () => {
    if (!clinicId) {
      setAppointments([])
      return
    }

    setLoadingAppointments(true)
    try {
      const q = query(
        collection(db, 'appointments'),
        where('clinicId', '==', clinicId),
        limit(50),
      )

      const snapshot = await getDocs(q)
      const rows: AppointmentRecord[] = []
      snapshot.forEach((doc) => {
        const data = doc.data() as Record<string, unknown>
        const startsAtValue = data.startsAt as
          | { toMillis?: () => number }
          | number
          | undefined
        const createdAtValue = data.createdAt as
          | { toMillis?: () => number }
          | number
          | undefined

        rows.push({
          id: doc.id,
          patientId: String(data.patientId ?? ''),
          clinicId: String(data.clinicId ?? clinicId),
          startsAt:
            typeof startsAtValue === 'number'
              ? startsAtValue
              : startsAtValue?.toMillis?.() ?? 0,
          mode: data.mode === 'in-clinic' ? 'in-clinic' : 'virtual',
          notes: String(data.notes ?? ''),
          status:
            data.status === 'completed' ||
            data.status === 'cancelled' ||
            data.status === 'accepted' ||
            data.status === 'rejected' ||
            data.status === 'rescheduled'
              ? data.status
              : 'scheduled',
          createdAt:
            typeof createdAtValue === 'number'
              ? createdAtValue
              : createdAtValue?.toMillis?.() ?? undefined,
        })
      })

      rows.sort((a, b) => a.startsAt - b.startsAt)
      setAppointments(rows)
    } catch (err) {
      console.error(err)
    } finally {
      setLoadingAppointments(false)
    }
  }, [clinicId])

  useEffect(() => {
    loadRecentSessions().catch(console.error)
    loadAppointments().catch(console.error)
  }, [loadRecentSessions, loadAppointments])

  const current = useMemo(
    () => live.find((entry) => entry.id === selectedPatient) ?? null,
    [live, selectedPatient],
  )

  const filteredRecent = useMemo(() => {
    const term = searchText.trim().toLowerCase()
    const uidFilter = focusedPatientUid?.trim() ?? ''
    return recent.filter((session) => {
      if (uidFilter && session.patientId !== uidFilter) return false
      if (exerciseFilter !== 'all' && session.exerciseId !== exerciseFilter) return false
      if (onlySelectedPatient && selectedPatient && session.patientId !== selectedPatient) return false
      if (!term) return true
      return (
        session.patientId.toLowerCase().includes(term) ||
        session.exerciseId.toLowerCase().includes(term)
      )
    })
  }, [recent, focusedPatientUid, exerciseFilter, onlySelectedPatient, selectedPatient, searchText])

  const trendData = useMemo(() => {
    const trendPatientId =
      focusedPatientUid?.trim() ||
      (selectedPatient && recent.some((session) => session.patientId === selectedPatient)
        ? selectedPatient
        : (recent[0]?.patientId ?? null))

    const source = trendPatientId
      ? recent.filter((session) => session.patientId === trendPatientId)
      : []

    return source
      .slice()
      .sort((a, b) => a.timestamp - b.timestamp)
      .slice(-12)
      .map((session) => ({
        label: new Date(session.timestamp).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        }),
        score: Number.isFinite(session.finalScore) ? Number(session.finalScore.toFixed(0)) : 0,
        accuracy: Number.isFinite(session.accuracyScore)
          ? Number(session.accuracyScore.toFixed(0))
          : 0,
      }))
  }, [recent, selectedPatient, focusedPatientUid])

  const trendPatientId = useMemo(
    () =>
      focusedPatientUid?.trim() ||
      (selectedPatient && recent.some((session) => session.patientId === selectedPatient)
        ? selectedPatient
        : (recent[0]?.patientId ?? null)),
    [recent, selectedPatient, focusedPatientUid],
  )

  const summary = useMemo(() => {
    const avgQuality = live.length
      ? live.reduce((sum, entry) => sum + entry.quality, 0) / live.length
      : 0
    const avgScore = recent.length
      ? recent.reduce((sum, row) => sum + row.finalScore, 0) / recent.length
      : 0

    return {
      liveCount: live.length,
      avgQuality,
      avgScore,
      recentCount: recent.length,
    }
  }, [live, recent])

  const exerciseOptions = useMemo(() => {
    const unique = new Set(recent.map((row) => row.exerciseId).filter(Boolean))
    return ['all', ...Array.from(unique)]
  }, [recent])

  const toggleFlag = (patientId: string) => {
    setFlagged((prev) => ({
      ...prev,
      [patientId]: !prev[patientId],
    }))
  }

  const applyUidFocus = () => {
    const trimmed = uidDraft.trim()
    setFocusedPatientUid(trimmed || null)
  }

  const clearUidFocus = () => {
    setUidDraft('')
    setFocusedPatientUid(null)
  }

  const updateAppointment = useCallback(
    async (
      appointmentId: string,
      patch: Partial<Pick<AppointmentRecord, 'status' | 'startsAt'>>,
    ) => {
      setUpdatingAppointmentId(appointmentId)
      try {
        await updateDoc(doc(db, 'appointments', appointmentId), patch)
        setAppointments((prev) =>
          prev.map((item) =>
            item.id === appointmentId
              ? {
                  ...item,
                  ...patch,
                }
              : item,
          ),
        )
      } catch (err) {
        console.error(err)
      } finally {
        setUpdatingAppointmentId(null)
      }
    },
    [],
  )

  const handleReschedule = useCallback(
    async (appointment: AppointmentRecord) => {
      const rawValue = rescheduleDrafts[appointment.id]
      if (!rawValue) return
      const nextStartsAt = new Date(rawValue).getTime()
      if (!Number.isFinite(nextStartsAt)) return

      await updateAppointment(appointment.id, {
        startsAt: nextStartsAt,
        status: 'rescheduled',
      })
    },
    [rescheduleDrafts, updateAppointment],
  )

  return (
    <div className="page">
      <header className="topbar">
        <div>
          <p className="eyebrow">Doctor</p>
          <h2>Realtime Monitoring</h2>
        </div>
        <div className="topbar-actions">
          <span>{user?.email}</span>
          <button
            className="secondary"
            onClick={() => {
              loadRecentSessions().catch(console.error)
              loadAppointments().catch(console.error)
            }}
          >
            {loadingRecent || loadingAppointments ? 'Refreshing...' : 'Refresh history'}
          </button>
          <button onClick={logout}>Sign out</button>
        </div>
      </header>

      <section className="kpi-grid" style={{ marginBottom: 16 }}>
        <div className="kpi-card">
          <p className="muted">Live sessions</p>
          <h3>{summary.liveCount}</h3>
        </div>
        <div className="kpi-card">
          <p className="muted">Avg live quality</p>
          <h3>{summary.liveCount ? `${summary.avgQuality.toFixed(0)}%` : '--'}</h3>
        </div>
        <div className="kpi-card">
          <p className="muted">Avg recent score</p>
          <h3>{summary.recentCount ? summary.avgScore.toFixed(0) : '--'}</h3>
        </div>
        <div className="kpi-card">
          <p className="muted">History rows</p>
          <h3>{summary.recentCount}</h3>
        </div>
      </section>

      <div className="grid two-col">
        <section className="card-lg">
          <div className="section-header">
            <h3>Live patient list</h3>
            <span className="muted">
              {live.length === 0 ? 'No active sessions' : `${live.length} currently streaming`}
            </span>
          </div>

          <div className="chips">
            {live.map((entry) => {
              const patientLabel = entry.patientId || entry.id
              return (
                <button
                  key={entry.id}
                  className={entry.id === selectedPatient ? 'chip active' : 'chip'}
                  onClick={() => setSelectedPatient(entry.id)}
                >
                  {patientLabel}
                </button>
              )
            })}
          </div>

          {current ? (
            <div className="live-grid">
              <div className="stat">
                <p className="muted">Patient</p>
                <h3>{current.patientId || current.id}</h3>
              </div>
              <div className="stat">
                <p className="muted">Exercise</p>
                <h3>{current.exerciseId}</h3>
              </div>
              <div className="stat">
                <p className="muted">Reps</p>
                <h3>{current.repCount}</h3>
              </div>
              <div className="stat">
                <p className="muted">Quality</p>
                <h3>{current.quality.toFixed(0)}%</h3>
              </div>
              <div className="stat">
                <p className="muted">Progress</p>
                <h3>{current.progress.toFixed(0)}%</h3>
              </div>
              <div className="stat">
                <p className="muted">Speed</p>
                <h3>{(current.speed ?? 0).toFixed(1)} rpm</h3>
              </div>
              <div className="stat">
                <p className="muted">Form score</p>
                <h3>{(current.formScore ?? current.quality).toFixed(0)}%</h3>
              </div>
              <div className="stat">
                <p className="muted">Status</p>
                <h3>{current.status || 'Active'}</h3>
              </div>
            </div>
          ) : (
            <p className="muted">Select a live patient to inspect current metrics.</p>
          )}

          {current && (
            <div className="actions">
              <button
                type="button"
                className={flagged[current.patientId] ? 'primary' : 'secondary'}
                onClick={() => toggleFlag(current.patientId)}
              >
                {flagged[current.patientId] ? 'Flagged for follow-up' : 'Mark for follow-up'}
              </button>
              <span className="muted">
                Updated {new Date(current.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          )}
        </section>

        <section className="card-lg">
          <div className="section-header">
            <h3>Patient trend</h3>
            <span className="muted">
              {trendPatientId ? `Patient ${trendPatientId}` : 'No patient data yet'}
            </span>
          </div>

          {trendData.length === 0 ? (
            <p className="muted">Trend chart appears after at least one saved session.</p>
          ) : (
            <div style={{ height: 280 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trendData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="label" />
                  <YAxis domain={[0, 100]} />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="score" stroke="#0ea5a3" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="accuracy" stroke="#f97316" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>
      </div>

      <section className="card-lg" style={{ marginTop: 16 }}>
        <div className="section-header">
          <h3>Session history</h3>
          <span className="muted">Filter and inspect saved patient records</span>
        </div>

        <div className="toolbar-row" style={{ marginBottom: 10 }}>
          <label className="field grow">
            <span>Analyze patient by UID</span>
            <input
              value={uidDraft}
              onChange={(event) => setUidDraft(event.target.value)}
              placeholder="Enter patient UID"
            />
          </label>
          <button type="button" className="secondary" onClick={applyUidFocus}>
            Load UID
          </button>
          <button
            type="button"
            className="secondary"
            onClick={clearUidFocus}
            disabled={!focusedPatientUid}
          >
            Clear UID
          </button>
        </div>

        {focusedPatientUid && (
          <p className="muted" style={{ marginBottom: 8 }}>
            Focus mode active for patient: {focusedPatientUid}
          </p>
        )}

        <div className="toolbar-row">
          <label className="field grow">
            <span>Search by patient or exercise</span>
            <input
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder="e.g. patient uid or head"
            />
          </label>

          <label className="field">
            <span>Exercise</span>
            <select
              value={exerciseFilter}
              onChange={(event) => setExerciseFilter(event.target.value)}
            >
              {exerciseOptions.map((option) => (
                <option key={option} value={option}>
                  {option === 'all' ? 'All exercises' : option}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            className={onlySelectedPatient ? 'primary' : 'secondary'}
            onClick={() => setOnlySelectedPatient((prev) => !prev)}
            disabled={!selectedPatient}
          >
            {onlySelectedPatient ? 'Showing selected only' : 'Filter selected patient'}
          </button>
        </div>

        {filteredRecent.length === 0 ? (
          <p className="muted">No session rows match the current filters.</p>
        ) : (
          <div className="session-table">
            <div className="session-row header">
              <span>Patient</span>
              <span>Exercise</span>
              <span>Score</span>
              <span>Reps</span>
              <span>Accuracy</span>
              <span>Speed</span>
              <span>When</span>
            </div>

            {filteredRecent.map((session) => (
              <div key={session.id ?? `${session.patientId}-${session.timestamp}`} className="session-row">
                <span title={session.patientId}>
                  {session.patientId.length > 16
                    ? `${session.patientId.slice(0, 10)}...${session.patientId.slice(-4)}`
                    : session.patientId}
                </span>
                <span>{session.exerciseId}</span>
                <span>{Number.isFinite(session.finalScore) ? session.finalScore.toFixed(0) : '-'}</span>
                <span>{session.repetitionCount}</span>
                <span>
                  {Number.isFinite(session.accuracyScore)
                    ? `${session.accuracyScore.toFixed(0)}%`
                    : '-'}
                </span>
                <span>{Number.isFinite(session.speed ?? 0) ? (session.speed ?? 0).toFixed(1) : '-'} rpm</span>
                <span>
                  {new Date(session.timestamp).toLocaleString([], {
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
      </section>

      <section className="card-lg" style={{ marginTop: 16 }}>
        <div className="section-header">
          <h3>Patient appointments</h3>
          <span className="muted">Appointments booked by patients in your clinic</span>
        </div>

        {loadingAppointments ? (
          <p className="muted">Loading appointments...</p>
        ) : appointments.length === 0 ? (
          <p className="muted">No appointments found for this clinic.</p>
        ) : (
          <div className="appointment-list">
            {appointments.map((appointment) => (
              <article key={appointment.id} className="appointment-item">
                <div>
                  <h4>
                    {new Date(appointment.startsAt).toLocaleString([], {
                      month: 'short',
                      day: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </h4>
                  <p className="muted">
                    Patient: {appointment.patientId} |{' '}
                    {appointment.mode === 'in-clinic' ? 'In-clinic' : 'Virtual'}
                  </p>
                  {appointment.notes && <p className="muted">Notes: {appointment.notes}</p>}
                </div>
                <div className="actions">
                  <span className={`status-chip status-${appointment.status}`}>
                    {appointment.status}
                  </span>
                  <button
                    type="button"
                    className="secondary"
                    disabled={
                      updatingAppointmentId === appointment.id ||
                      appointment.status === 'rejected'
                    }
                    onClick={() =>
                      updateAppointment(appointment.id, { status: 'accepted' }).catch(
                        console.error,
                      )
                    }
                  >
                    Accept
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    disabled={updatingAppointmentId === appointment.id}
                    onClick={() =>
                      updateAppointment(appointment.id, { status: 'rejected' }).catch(
                        console.error,
                      )
                    }
                  >
                    Reject
                  </button>
                </div>
                <div className="actions">
                  <input
                    type="datetime-local"
                    value={rescheduleDrafts[appointment.id] ?? ''}
                    onChange={(event) =>
                      setRescheduleDrafts((prev) => ({
                        ...prev,
                        [appointment.id]: event.target.value,
                      }))
                    }
                  />
                  <button
                    type="button"
                    className="secondary"
                    disabled={
                      updatingAppointmentId === appointment.id ||
                      !rescheduleDrafts[appointment.id]
                    }
                    onClick={() => handleReschedule(appointment).catch(console.error)}
                  >
                    Reschedule
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

export default DoctorPage
