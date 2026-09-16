'use server'

import { createClient } from '@/lib/supabase/server'

/**
 * Compute next_due_date from interval_type + last performed date (Plan.md §5 Form 15/16)
 */
function computeNextDueDate(
  intervalType: string,
  intervalCustomMonths: number | null,
  fromDate: Date
): string {
  const d = new Date(fromDate)
  switch (intervalType) {
    case 'DAILY':
      d.setDate(d.getDate() + 1)
      break
    case 'WEEKLY':
      d.setDate(d.getDate() + 7)
      break
    case 'MONTHLY':
      d.setMonth(d.getMonth() + 1)
      break
    case 'CUSTOM_MONTHS':
      d.setMonth(d.getMonth() + (intervalCustomMonths ?? 3))
      break
    case 'YEARLY':
      d.setFullYear(d.getFullYear() + 1)
      break
    default:
      d.setMonth(d.getMonth() + 1)
  }
  return d.toISOString().split('T')[0]
}

export interface ExecutePMSChecklistInput {
  assetId: number
  checklistJson: Record<string, 'Passed' | 'Adjusted' | 'Needs Replacement'>
}

/**
 * Form 15 — Execute PMS Checklist (non-aircon assets) (Plan.md §5 Form 15)
 * Writes pms_activity_logs, updates pms_assets.last_performed_date + next_due_date.
 */
export async function executePMSChecklist(input: ExecutePMSChecklistInput) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) throw new Error('Authentication required.')

  // Fetch current asset data for interval calculation
  const { data: asset, error: fetchError } = await supabase
    .from('pms_assets')
    .select('id, interval_type, interval_custom_months, next_due_date, is_aircon')
    .eq('id', input.assetId)
    .single()

  if (fetchError || !asset) throw new Error('PMS Asset not found.')
  if (asset.is_aircon) throw new Error('Use the Aircon form for aircon assets.')

  const today = new Date()
  const nextDueDate = computeNextDueDate(
    asset.interval_type,
    asset.interval_custom_months,
    today
  )

  // Insert activity log
  const { error: logError } = await supabase
    .from('pms_activity_logs')
    .insert({
      asset_id: input.assetId,
      performed_by: user.id,
      checklist_json: input.checklistJson,
      performed_at: today.toISOString(),
    })

  if (logError) throw new Error(logError.message)

  // Update asset's last_performed_date and next_due_date
  const { error: updateError } = await supabase
    .from('pms_assets')
    .update({
      last_performed_date: today.toISOString().split('T')[0],
      next_due_date: nextDueDate,
    })
    .eq('id', input.assetId)

  if (updateError) throw new Error(updateError.message)

  return { success: true, nextDueDate }
}

export interface ExecuteAirconServiceInput {
  assetId: number
  checklistJson: Record<string, 'Passed' | 'Adjusted' | 'Needs Replacement'>
  freonPressurePsi?: number
  compressorAmperage?: number
  photoUrl?: string
}

/**
 * Form 16 — Complete 3-Month Aircon Service (Plan.md §5 Form 16)
 * Writes pms_activity_logs with freon/amperage readings + photo attachment.
 * Resets the 3-month service cycle.
 */
export async function executeAirconService(input: ExecuteAirconServiceInput) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) throw new Error('Authentication required.')

  const { data: asset, error: fetchError } = await supabase
    .from('pms_assets')
    .select('id, interval_type, interval_custom_months, is_aircon')
    .eq('id', input.assetId)
    .single()

  if (fetchError || !asset) throw new Error('Aircon asset not found.')
  if (!asset.is_aircon) throw new Error('This asset is not an aircon unit. Use the PMS Checklist form.')

  const today = new Date()
  // Aircon defaults to 3-month cycle per Plan.md §5 Form 16
  const nextDueDate = computeNextDueDate('CUSTOM_MONTHS', 3, today)

  const { error: logError } = await supabase
    .from('pms_activity_logs')
    .insert({
      asset_id: input.assetId,
      performed_by: user.id,
      checklist_json: input.checklistJson,
      freon_pressure_psi: input.freonPressurePsi ?? null,
      compressor_amperage: input.compressorAmperage ?? null,
      performed_at: today.toISOString(),
    })

  if (logError) throw new Error(logError.message)

  // Attach service photo if provided (context = 'AIRCON_SERVICE_PHOTO')
  if (input.photoUrl) {
    await supabase.from('attachments').insert({
      context: 'AIRCON_SERVICE_PHOTO',
      entity_type: 'pms_asset',
      entity_id: input.assetId,
      file_url: input.photoUrl,
      uploaded_by: user.id,
    })
  }

  const { error: updateError } = await supabase
    .from('pms_assets')
    .update({
      last_performed_date: today.toISOString().split('T')[0],
      next_due_date: nextDueDate,
    })
    .eq('id', input.assetId)

  if (updateError) throw new Error(updateError.message)

  return { success: true, nextDueDate }
}

export interface RegisterPMSAssetInput {
  asset_name: string
  category: 'HVAC' | 'ELECTRICAL' | 'PLUMBING' | 'STRUCTURAL' | 'KITCHEN_EQUIPMENT' | 'GENERAL'
  location: string
  interval_type: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'CUSTOM_MONTHS' | 'YEARLY'
  interval_custom_months?: number | null
  next_due_date: string
  is_aircon: boolean
}

/**
 * Register a new PMS Asset (Equipment or Aircon Unit)
 * Gated to SUPER_ADMIN, MANAGER, and MAINTENANCE.
 */
export async function registerPMSAsset(input: RegisterPMSAssetInput) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) throw new Error('Authentication required.')

  const { data: profile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!profile || !['SUPER_ADMIN', 'MANAGER', 'MAINTENANCE'].includes(profile.role)) {
    throw new Error('Unauthorized. Only Super Admin, Manager, and Maintenance staff can register assets.')
  }

  if (!input.asset_name?.trim()) throw new Error('Asset name is required.')
  if (!input.location?.trim()) throw new Error('Location is required.')
  if (!input.next_due_date) throw new Error('Next due date is required.')

  const { data, error } = await supabase
    .from('pms_assets')
    .insert({
      asset_name: input.asset_name.trim(),
      category: input.category,
      location: input.location.trim(),
      interval_type: input.interval_type,
      interval_custom_months:
        input.interval_type === 'CUSTOM_MONTHS'
          ? (input.interval_custom_months ?? 3)
          : input.is_aircon
          ? 3
          : null,
      next_due_date: input.next_due_date,
      is_aircon: Boolean(input.is_aircon),
    })
    .select()
    .single()

  if (error) throw new Error(error.message)
  return { success: true, asset: data }
}
