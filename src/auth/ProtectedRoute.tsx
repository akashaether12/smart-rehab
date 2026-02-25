import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import useAuth from './useAuth'
import type { Role } from './AuthProvider'

type Props = {
  roles: Role[]
  children: ReactNode
}

function ProtectedRoute({ roles, children }: Props) {
  const { user, role, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="center-page">
        <div className="spinner" />
        <p>Loading session...</p>
      </div>
    )
  }

  if (!user || !role || !roles.includes(role)) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }

  return <>{children}</>
}

export default ProtectedRoute
