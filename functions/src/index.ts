import * as admin from 'firebase-admin'
import { HttpsError, onCall, setGlobalOptions } from 'firebase-functions/v2/https'

admin.initializeApp()
setGlobalOptions({ region: 'us-central1' })

type Role = 'admin' | 'doctor' | 'patient'

export const createUserWithRole = onCall(
  { cors: true },
  async (request) => {
    const caller = request.auth
    if (!caller || caller.token.role !== 'admin') {
      throw new HttpsError('permission-denied', 'Admin only')
    }

    const { email, password, role, clinicId } = request.data as {
      email?: string
      password?: string
      role?: Role
      clinicId?: string
    }

    if (!email || !password || !role || !clinicId) {
      throw new HttpsError('invalid-argument', 'Missing required fields')
    }
    if (!['doctor', 'patient', 'admin'].includes(role)) {
      throw new HttpsError('invalid-argument', 'Invalid role')
    }

    const user = await admin.auth().createUser({
      email,
      password,
      emailVerified: true,
      disabled: false,
    })

    await admin.auth().setCustomUserClaims(user.uid, {
      role,
      clinicId,
    })

    return { uid: user.uid, email, role, clinicId }
  },
)
