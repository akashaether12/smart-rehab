import { signInWithEmailAndPassword } from 'firebase/auth'
import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import useAuth from '../auth/useAuth'
import { auth } from '../firebase'

type LocationState = {
  from?: {
    pathname: string
    search?: string
  }
}

function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { role, loading: authLoading } = useAuth()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const fromState = useMemo(
    () => (location.state as LocationState | null)?.from,
    [location.state],
  )

  const redirectToRole = (nextRole: string) => {
    if (nextRole === 'admin') {
      navigate('/admin', { replace: true })
      return
    }
    if (nextRole === 'doctor') {
      navigate('/doctor', { replace: true })
      return
    }
    navigate('/patient', { replace: true })
  }

  useEffect(() => {
    if (!authLoading && role) {
      redirectToRole(role)
    }
  }, [authLoading, role])

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    setSubmitting(true)

    try {
      await signInWithEmailAndPassword(auth, email.trim(), password)

      if (fromState?.pathname) {
        navigate(`${fromState.pathname}${fromState.search ?? ''}`, {
          replace: true,
        })
        return
      }

      // Role is resolved by AuthProvider (claims first, DB fallback next).
      // Route via home redirect so doctor/patient/admin land correctly.
      navigate('/', { replace: true })
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Unable to sign in. Please check your credentials.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="shell">
      <div className="card-lg login-layout">
        <section className="login-visual">
          <img
            src="/images/hero-rehab.svg"
            alt="Rehabilitation training illustration"
            className="hero-image"
          />
          <div className="stack-sm">
            <h1>RehabFlow AI</h1>
            <p className="muted">
              Role-aware rehabilitation workspace for admins, clinicians, and patients.
            </p>
          </div>
          <div className="pill-row">
            <span className="pill">Live session tracking</span>
            <span className="pill">Clinical scorecards</span>
            <span className="pill">Patient progress timeline</span>
          </div>
        </section>

        <section className="login-form-wrap">
          <h2>Sign in</h2>
          <p className="muted">Use your assigned clinic account.</p>

          <form onSubmit={onSubmit} className="stack-md">
            <label className="field">
              <span>Email</span>
              <input
                required
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                placeholder="name@clinic.com"
              />
            </label>

            <label className="field">
              <span>Password</span>
              <div className="password-row">
                <input
                  required
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  placeholder="Enter password"
                />
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setShowPassword((prev) => !prev)}
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
            </label>

            {error && <div className="error">{error}</div>}

            <button className="primary" type="submit" disabled={submitting || authLoading}>
              {submitting ? 'Signing in...' : 'Continue'}
            </button>
          </form>
        </section>
      </div>
    </div>
  )
}

export default LoginPage
