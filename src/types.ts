export type LiveMetrics = {
  repCount: number
  quality: number
  progress: number
  updatedAt: number
  exerciseId: string
  patientId: string
  status?: string
  accuracy?: number
  speed?: number
  stability?: number
  formScore?: number
  doctorId?: string
}

export type SessionRecord = {
  id?: string
  exerciseId: string
  duration: number
  repetitionCount: number
  accuracyScore: number
  finalScore: number
  speed?: number
  stability?: number
  formScore?: number
  qualityAvg?: number
  timestamp: number
  clinicId: string
  doctorId: string
  patientId: string
}

export type AppointmentRecord = {
  id: string
  patientId: string
  clinicId: string
  startsAt: number
  mode: 'virtual' | 'in-clinic'
  notes: string
  status:
    | 'scheduled'
    | 'completed'
    | 'cancelled'
    | 'accepted'
    | 'rejected'
    | 'rescheduled'
  createdAt?: number
}
