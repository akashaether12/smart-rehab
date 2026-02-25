import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import AuthProvider from './auth/AuthProvider'
import ProtectedRoute from './auth/ProtectedRoute'
import useAuth from './auth/useAuth'
import AdminPage from './pages/AdminPage'
import DoctorPage from './pages/DoctorPage'
import LoginPage from './pages/LoginPage'
import PatientPage from './pages/PatientPage'
import './App.css'

function HomeRedirect() {
  const { loading, role } = useAuth()

  if (loading) {
    return (
      <div className="center-page">
        <div className="spinner" />
        <p>Loading session...</p>
      </div>
    )
  }

  if (role === 'admin') return <Navigate to="/admin" replace />
  if (role === 'doctor') return <Navigate to="/doctor" replace />
  if (role === 'patient') return <Navigate to="/patient" replace />
  return <Navigate to="/login" replace />
}

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<HomeRedirect />} />
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/patient"
            element={
              <ProtectedRoute roles={['patient']}>
                <PatientPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/patient/session"
            element={
              <ProtectedRoute roles={['patient']}>
                <PatientPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/doctor"
            element={
              <ProtectedRoute roles={['doctor']}>
                <DoctorPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin"
            element={
              <ProtectedRoute roles={['admin']}>
                <AdminPage />
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}

export default App
