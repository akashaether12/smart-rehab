import {
  type User,
  getIdTokenResult,
  onAuthStateChanged,
  signOut,
} from 'firebase/auth'
import { get, ref } from 'firebase/database'
import {
  type PropsWithChildren,
  createContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { auth, rtdb } from '../firebase'

export type Role = 'admin' | 'doctor' | 'patient'

type AuthContextValue = {
  user: User | null
  role: Role | null
  clinicId: string | null
  loading: boolean
  logout: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue>({
  user: null,
  role: null,
  clinicId: null,
  loading: true,
  logout: async () => {},
})

function AuthProvider({ children }: PropsWithChildren) {
  const [user, setUser] = useState<User | null>(null)
  const [role, setRole] = useState<Role | null>(null)
  const [clinicId, setClinicId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser)
      if (firebaseUser) {
        const token = await getIdTokenResult(firebaseUser, true)
        const claims = token.claims as { role?: Role; clinicId?: string }
        let nextRole = claims.role ?? null
        let nextClinicId = claims.clinicId ?? null

        if (!nextRole || !nextClinicId) {
          try {
            const roleSnap = await get(ref(rtdb, `userRoles/${firebaseUser.uid}`))
            if (roleSnap.exists()) {
              const roleData = roleSnap.val() as {
                role?: Role
                clinicId?: string
              }
              nextRole = nextRole ?? roleData.role ?? null
              nextClinicId = nextClinicId ?? roleData.clinicId ?? null
            }
          } catch (error) {
            console.error('Failed to fetch user role fallback', error)
          }
        }

        setRole(nextRole)
        setClinicId(nextClinicId)
      } else {
        setRole(null)
        setClinicId(null)
      }
      setLoading(false)
    })
    return () => unsub()
  }, [])

  const value = useMemo(
    () => ({
      user,
      role,
      clinicId,
      loading,
      logout: () => signOut(auth),
    }),
    [user, role, clinicId, loading],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export default AuthProvider
