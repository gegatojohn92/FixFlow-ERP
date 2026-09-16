import React, { useRef, useState } from 'react'
import { Camera, Image as ImageIcon, X, Loader2, Upload, AlertCircle, Eye, Maximize2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import type { PhotoContext } from '@/types/index'
import { PhotoLightbox } from '@/components/ui/PhotoLightbox'

export interface AttachmentRecord {
  id?: number
  file_url: string
  context: PhotoContext
  entity_type: string
  entity_id: number
  uploaded_by?: string
  file_name?: string
}

export interface CameraCaptureProps {
  context: PhotoContext
  entityType?: string
  entityId?: number
  bucket?: string
  maxFiles?: number
  existingAttachments?: AttachmentRecord[]
  onAttachmentsChange?: (attachments: AttachmentRecord[]) => void
  onUploadComplete?: (url: string) => void
  disabled?: boolean
  label?: string
  helperText?: string
}

// Map each photo context to its target Supabase storage bucket (§1.2 / §3.2)
function getStorageBucket(context: PhotoContext): string {
  switch (context) {
    case 'JO_SITE_PHOTO':
    case 'JO_REOPEN_PHOTO':
    case 'AIRCON_SERVICE_PHOTO':
      return 'site-photos'
    case 'MRS_ITEM_REFERENCE':
    case 'MRS_ONLINE_SCREENSHOT':
      return 'item-references'
    case 'PURCHASE_RECEIPT':
    case 'DELIVERY_PROOF':
    case 'FD_COD_RECEIPT':
      return 'receipts-proofs'
    default:
      return 'site-photos'
  }
}

export function CameraCapture({
  context,
  entityType = 'attachment',
  entityId,
  bucket,
  maxFiles = 3,
  existingAttachments = [],
  onAttachmentsChange,
  onUploadComplete,
  disabled = false,
  label = 'Photos & Attachments',
  helperText,
}: CameraCaptureProps) {
  const [attachments, setAttachments] = useState<AttachmentRecord[]>(existingAttachments)
  const [lightboxImage, setLightboxImage] = useState<string | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const cameraInputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const supabase = createClient()
  const bucketName = bucket || getStorageBucket(context)


  const handleFilesSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return

    setError(null)
    const availableSlots = maxFiles - attachments.length
    if (files.length > availableSlots) {
      setError(`You can only add up to ${maxFiles} photo(s). (${availableSlots} slot(s) remaining)`)
      return
    }

    setIsUploading(true)
    const newAttachments: AttachmentRecord[] = []

    try {
      const { data: { user } } = await supabase.auth.getUser()

      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        setUploadProgress(`Uploading ${i + 1} of ${files.length}...`)

        // Validate max size (10MB limit)
        if (file.size > 10 * 1024 * 1024) {
          throw new Error(`"${file.name}" exceeds the 10MB size limit.`)
        }

        const cleanName = file.name.replace(/[^a-zA-Z0-9.]/g, '_')
        const timestamp = new Date().getTime()
        const filePath = `${entityType}/${entityId ?? 'pending'}/${timestamp}_${cleanName}`

        // Upload to Supabase Storage bucket
        const { error: uploadError } = await supabase.storage
          .from(bucketName)
          .upload(filePath, file, {
            cacheControl: '3600',
            upsert: false,
          })

        if (uploadError) throw uploadError

        // Get public URL
        const { data: { publicUrl } } = supabase.storage
          .from(bucketName)
          .getPublicUrl(filePath)

        let recordId: number | undefined = undefined

        // If entityId exists, immediately persist to attachments table (§3.2 table 9)
        if (entityId && user) {
          const { data: insertData, error: dbError } = await supabase
            .from('attachments')
            .insert({
              context,
              entity_type: entityType,
              entity_id: entityId,
              file_url: publicUrl,
              uploaded_by: user.id,
            })
            .select('id')
            .single()

          if (dbError) {
            console.error('Failed to write to attachments table:', dbError)
          } else {
            recordId = insertData?.id
          }
        }

        newAttachments.push({
          id: recordId,
          file_url: publicUrl,
          context,
          entity_type: entityType,
          entity_id: entityId ?? 0,
          uploaded_by: user?.id,
          file_name: file.name,
        })
      }

      const updated = [...attachments, ...newAttachments]
      setAttachments(updated)
      onAttachmentsChange?.(updated)
      if (newAttachments.length > 0 && onUploadComplete) {
        onUploadComplete(newAttachments[newAttachments.length - 1].file_url)
      }
    } catch (err: unknown) {
      let msg = err instanceof Error ? err.message : 'Upload failed. Please try again.'
      if (msg.includes('Bucket') || msg.includes('bucket') || msg.includes('400')) {
        msg = `Storage bucket error: "${bucketName}" not accessible. Please run migration 0008 in Supabase to make storage buckets public.`
      }
      setError(msg)
    } finally {
      setIsUploading(false)
      setUploadProgress(null)
      // Reset inputs so the same file can be re-selected if needed
      if (cameraInputRef.current) cameraInputRef.current.value = ''
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleRemove = async (index: number) => {
    const itemToRemove = attachments[index]
    setError(null)

    // If item was stored in DB, delete it
    if (itemToRemove.id) {
      try {
        const { error: dbError } = await supabase
          .from('attachments')
          .delete()
          .eq('id', itemToRemove.id)

        if (dbError) throw dbError
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Failed to delete attachment record.'
        setError(msg)
        return
      }
    }

    const updated = attachments.filter((_, i) => i !== index)
    setAttachments(updated)
    onAttachmentsChange?.(updated)
  }

  const canAddMore = attachments.length < maxFiles && !disabled && !isUploading

  return (
    <div className="w-full space-y-3">
      <div className="flex items-center justify-between">
        <label className="block text-sm font-medium text-slate-200">
          {label} <span className="text-xs text-slate-400 font-normal">({attachments.length}/{maxFiles})</span>
        </label>
        {helperText && <span className="text-xs text-slate-400">{helperText}</span>}
      </div>

      {error && (
        <div className="flex items-center gap-2 p-2 text-sm text-red-400 bg-red-950/40 border border-red-800 rounded-lg">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Hidden file & camera inputs */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleFilesSelected}
        disabled={disabled || isUploading}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple={maxFiles > 1}
        className="hidden"
        onChange={handleFilesSelected}
        disabled={disabled || isUploading}
      />

      {/* Action Buttons */}
      {canAddMore && (
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => cameraInputRef.current?.click()}
            disabled={disabled || isUploading}
            className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-slate-700 bg-slate-800/80 hover:bg-slate-700 text-slate-200 text-sm font-medium transition-colors disabled:opacity-50"
          >
            <Camera className="w-4 h-4 text-blue-400" />
            <span>Take Photo</span>
          </button>

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled || isUploading}
            className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-slate-700 bg-slate-800/80 hover:bg-slate-700 text-slate-200 text-sm font-medium transition-colors disabled:opacity-50"
          >
            <ImageIcon className="w-4 h-4 text-emerald-400" />
            <span>Upload Image</span>
          </button>
        </div>
      )}

      {/* Uploading Status Indicator */}
      {isUploading && (
        <div className="flex items-center justify-center gap-2 py-4 px-3 bg-slate-900/60 border border-blue-900/50 rounded-lg text-sm text-blue-300">
          <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
          <span>{uploadProgress || 'Uploading...'}</span>
        </div>
      )}

      {/* Attachments Preview Grid */}
      {attachments.length > 0 && (
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2.5 pt-1">
          {attachments.map((item, idx) => (
            <div
              key={item.id ?? idx}
              className="group relative aspect-square rounded-xl overflow-hidden border border-slate-700 bg-slate-900 shadow-sm"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={item.file_url}
                alt={`Attachment ${idx + 1}`}
                className="w-full h-full object-cover transition-transform group-hover:scale-105 cursor-pointer"
                onClick={() => setLightboxImage(item.file_url)}
              />

              {/* Hover Action Overlay */}
              <div className="absolute inset-0 bg-slate-950/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2 pointer-events-none">
                <button
                  type="button"
                  onClick={() => setLightboxImage(item.file_url)}
                  className="pointer-events-auto p-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white shadow transition-all"
                  title="View full photo"
                >
                  <Eye className="w-3.5 h-3.5" />
                </button>
                {!disabled && (
                  <button
                    type="button"
                    onClick={() => handleRemove(idx)}
                    className="pointer-events-auto p-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white shadow transition-all"
                    title="Remove image"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* Always-visible view button badge for mobile touch devices */}
              <button
                type="button"
                onClick={() => setLightboxImage(item.file_url)}
                className="sm:hidden absolute bottom-1 left-1 px-1.5 py-0.5 rounded bg-black/75 text-white text-[9px] font-semibold flex items-center gap-1 backdrop-blur-sm"
              >
                <Eye className="w-2.5 h-2.5" /> View
              </button>
            </div>
          ))}
        </div>
      )}

      {attachments.length === 0 && !isUploading && (
        <div className="flex flex-col items-center justify-center py-6 px-4 border-2 border-dashed border-slate-800 rounded-lg text-slate-500">
          <Upload className="w-6 h-6 mb-1.5 opacity-50" />
          <p className="text-xs text-center">No photos attached yet. Use camera or upload from files.</p>
        </div>
      )}

      {/* Lightbox Modal */}
      <PhotoLightbox
        isOpen={Boolean(lightboxImage)}
        onClose={() => setLightboxImage(null)}
        imageUrl={lightboxImage}
        title={label}
        context={context}
      />
    </div>
  )
}

export default CameraCapture

