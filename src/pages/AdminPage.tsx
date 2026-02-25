import { httpsCallable } from 'firebase/functions'
import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import {
  collection,
  getDocs,
  limit,
  query,
  where,
} from 'firebase/firestore'
import useAuth from '../auth/useAuth'
import { db, functions } from '../firebase'
import type { SessionRecord } from '../types'

function AdminPage() {
  const { user, clinicId: adminClinicId, logout } = useAuth()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<'doctor' | 'patient'>('doctor')
  const [targetClinicId, setTargetClinicId] = useState(adminClinicId ?? '')

  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loadingCreate, setLoadingCreate] = useState(false)

  const [activity, setActivity] = useState<SessionRecord[]>([])
  const [loadingActivity, setLoadingActivity] = useState(false)

  useEffect(() => {
    if (!targetClinicId && adminClinicId) {
      setTargetClinicId(adminClinicId)
    }
  }, [adminClinicId, targetClinicId])

  const fetchActivity = useCallback(async () => {
    const clinic = targetClinicId.trim()
    if (!clinic) {
      setActivity([])
      return
    }

    setLoadingActivity(true)
    try {
      const clinicQuery = query(
        collection(db, 'sessions'),
        where('clinicId', '==', clinic),
        limit(20),
      )

      const snapshot = await getDocs(clinicQuery)
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
          clinicId: String(data.clinicId ?? clinic),
          doctorId: String(data.doctorId ?? ''),
          patientId: String(data.patientId ?? ''),
        })
      })

      rows.sort((a, b) => b.timestamp - a.timestamp)
      setActivity(rows)
    } catch (err) {
      console.error(err)
      setError('Failed to load clinic activity.')
    } finally {
      setLoadingActivity(false)
    }
  }, [targetClinicId])

  useEffect(() => {
    fetchActivity().catch(console.error)
  }, [fetchActivity])

  const createUser = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    setMessage(null)

    const clinic = targetClinicId.trim()
    if (!clinic) {
      setError('Clinic ID is required.')
      return
    }

    setLoadingCreate(true)
    try {
      const callable = httpsCallable(functions, 'createUserWithRole')
      await callable({
        email: email.trim(),
        password,
        role,
        clinicId: clinic,
      })

      setMessage(`Created ${role} account for ${email.trim()}`)
      setEmail('')
      setPassword('')
      await fetchActivity()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create user account.')
    } finally {
      setLoadingCreate(false)
    }
  }

  const summary = useMemo(() => {
    if (!activity.length) {
      return {
        sessions: 0,
        uniquePatients: 0,
        avgScore: 0,
        avgAccuracy: 0,
      }
    }

    const uniquePatients = new Set(activity.map((row) => row.patientId).filter(Boolean)).size
    const avgScore =
      activity.reduce((sum, row) => sum + (Number.isFinite(row.finalScore) ? row.finalScore : 0), 0) /
      activity.length
    const avgAccuracy =
      activity.reduce(
        (sum, row) => sum + (Number.isFinite(row.accuracyScore) ? row.accuracyScore : 0),
        0,
      ) / activity.length

    return {
      sessions: activity.length,
      uniquePatients,
      avgScore,
      avgAccuracy,
    }
  }, [activity])

  const copyClinic = async () => {
    if (!targetClinicId.trim()) {
      setError('Enter a Clinic ID before copying.')
      return
    }

    try {
      await navigator.clipboard.writeText(targetClinicId.trim())
      setMessage('Clinic ID copied to clipboard.')
    } catch {
      setError('Clipboard access failed. Copy manually instead.')
    }
  }

  return (
    <div className="page">
      <header className="topbar">
        <div>
          <p className="eyebrow">Admin</p>
          <h2>Clinic Operations</h2>
        </div>
        <div className="topbar-actions">
          <span>{user?.email}</span>
          <button onClick={logout}>Sign out</button>
        </div>
      </header>

      <div className="grid two-col">
        <section className="card-lg">
          <div className="section-header">
            <h3>Create a new account</h3>
            <span className="badge">Callable Function</span>
          </div>

          <form className="stack-md" onSubmit={createUser}>
            <label className="field">
              <span>Role</span>
              <select
                value={role}
                onChange={(event) => setRole(event.target.value as 'doctor' | 'patient')}
              >
                <option value="doctor">Doctor</option>
                <option value="patient">Patient</option>
              </select>
            </label>

            <label className="field">
              <span>Clinic ID</span>
              <div className="inline-field">
                <input
                  required
                  value={targetClinicId}
                  onChange={(event) => setTargetClinicId(event.target.value)}
                  placeholder="clinic-001"
                />
                <button type="button" className="secondary" onClick={copyClinic}>
                  Copy
                </button>
              </div>
            </label>

            <label className="field">
              <span>Email</span>
              <input
                required
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="new.user@clinic.com"
              />
            </label>

            <label className="field">
              <span>Temporary password</span>
              <input
                required
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                minLength={6}
              />
            </label>

            {message && <div className="success">{message}</div>}
            {error && <div className="error">{error}</div>}

            <button className="primary" type="submit" disabled={loadingCreate}>
              {loadingCreate ? 'Creating account...' : 'Create account'}
            </button>
          </form>
        </section>

        <section className="card-lg">
          <div className="section-header">
            <h3>Clinic snapshot</h3>
            <button type="button" className="secondary" onClick={() => fetchActivity()}>
              {loadingActivity ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>

          <div className="kpi-grid">
            <div className="kpi-card">
              <p className="muted">Recent sessions</p>
              <h3>{summary.sessions}</h3>
            </div>
            <div className="kpi-card">
              <p className="muted">Active patients</p>
              <h3>{summary.uniquePatients}</h3>
            </div>
            <div className="kpi-card">
              <p className="muted">Avg score</p>
              <h3>{summary.avgScore ? summary.avgScore.toFixed(0) : '--'}</h3>
            </div>
            <div className="kpi-card">
              <p className="muted">Avg accuracy</p>
              <h3>{summary.avgAccuracy ? `${summary.avgAccuracy.toFixed(0)}%` : '--'}</h3>
            </div>
          </div>

          <div className="callout">
            Use the same Clinic ID for doctors and patients who should share dashboards.
          </div>
        </section>
      </div>

      <section className="card-lg" style={{ marginTop: 16 }}>
        <div className="section-header">
          <h3>Latest clinic sessions</h3>
          <span className="muted">Up to 20 recent records</span>
        </div>

        {loadingActivity ? (
          <div className="muted">Loading sessions...</div>
        ) : activity.length === 0 ? (
          <div className="muted">No sessions found for this clinic.</div>
        ) : (
          <div className="session-table">
            <div className="session-row header">
              <span>Patient</span>
              <span>Exercise</span>
              <span>Reps</span>
              <span>Accuracy</span>
              <span>Score</span>
              <span>Duration</span>
              <span>When</span>
            </div>
            {activity.map((session) => (
              <div key={session.id ?? `${session.patientId}-${session.timestamp}`} className="session-row">
                <span>{session.patientId || '-'}</span>
                <span>{session.exerciseId || '-'}</span>
                <span>{session.repetitionCount}</span>
                <span>{Number.isFinite(session.accuracyScore) ? `${session.accuracyScore.toFixed(0)}%` : '-'}</span>
                <span>{Number.isFinite(session.finalScore) ? session.finalScore.toFixed(0) : '-'}</span>
                <span>{(session.duration / 60).toFixed(1)} min</span>
                <span>
                  {session.timestamp
                    ? new Date(session.timestamp).toLocaleString([], {
                        month: 'short',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })
                    : '-'}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

export default AdminPage
