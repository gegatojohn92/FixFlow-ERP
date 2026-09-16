'use client'

import React, { useEffect, useRef, useState } from 'react'
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode'
import {
  ScanLine,
  Camera,
  CameraOff,
  SwitchCamera,
  CheckCircle2,
  AlertCircle,
  Keyboard,
  ArrowRight,
} from 'lucide-react'

export interface BarcodeScannerProps {
  onScan: (decodedText: string) => void
  onError?: (error: string) => void
  label?: string
  placeholder?: string
  autoStart?: boolean
  className?: string
}

export function BarcodeScanner({
  onScan,
  onError,
  label = 'Scan Barcode / Tracking Number',
  placeholder = 'Scan with camera or enter code manually...',
  autoStart = false,
  className = '',
}: BarcodeScannerProps) {
  const [isScanning, setIsScanning] = useState(false)
  const [lastScanned, setLastScanned] = useState<string | null>(null)
  const [scanError, setScanError] = useState<string | null>(null)
  const [manualCode, setManualCode] = useState('')
  const [cameras, setCameras] = useState<{ id: string; label: string }[]>([])
  const [selectedCameraId, setSelectedCameraId] = useState<string | null>(null)
  const [isInitializing, setIsInitializing] = useState(false)

  const scannerRef = useRef<Html5Qrcode | null>(null)
  const uniqueId = React.useId()
  const regionId = `barcode-reader-${uniqueId.replace(/[^a-zA-Z0-9]/g, '')}`

  const triggerSuccessFeedback = React.useCallback(() => {
    // Haptic vibration feedback
    if (typeof window !== 'undefined' && 'vibrate' in navigator) {
      try {
        navigator.vibrate([80, 40, 80])
      } catch {
        // Safe ignore
      }
    }

    // Audio chime feedback using Web Audio API (no external asset needed)
    if (typeof window !== 'undefined' && (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)) {
      try {
        const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
        const ctx = new AudioCtx()
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.type = 'sine'
        osc.frequency.setValueAtTime(880, ctx.currentTime) // A5
        osc.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.12) // E6
        gain.gain.setValueAtTime(0.2, ctx.currentTime)
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.18)
        osc.connect(gain)
        gain.connect(ctx.destination)
        osc.start()
        osc.stop(ctx.currentTime + 0.2)
      } catch {
        // Safe ignore
      }
    }
  }, [])

  const startScanning = React.useCallback(async () => {
    setScanError(null)
    setIsInitializing(true)

    try {
      if (!scannerRef.current) {
        scannerRef.current = new Html5Qrcode(regionId, {
          formatsToSupport: [
            Html5QrcodeSupportedFormats.CODE_128,
            Html5QrcodeSupportedFormats.CODE_39,
            Html5QrcodeSupportedFormats.EAN_13,
            Html5QrcodeSupportedFormats.EAN_8,
            Html5QrcodeSupportedFormats.UPC_A,
            Html5QrcodeSupportedFormats.UPC_E,
            Html5QrcodeSupportedFormats.QR_CODE,
          ],
          verbose: false,
        })
      }

      const cameraIdOrConfig = selectedCameraId
        ? { deviceId: { exact: selectedCameraId } }
        : { facingMode: 'environment' }

      await scannerRef.current.start(
        cameraIdOrConfig,
        {
          fps: 15,
          qrbox: { width: 280, height: 160 },
          aspectRatio: 1.777,
        },
        (decodedText) => {
          triggerSuccessFeedback()
          setLastScanned(decodedText)
          setManualCode(decodedText)
          onScan(decodedText)
        },
        () => {
          // Frame read non-matches are ignored quietly
        }
      )

      setIsScanning(true)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Could not access camera. Please check permissions.'
      setScanError(msg)
      onError?.(msg)
    } finally {
      setIsInitializing(false)
    }
  }, [regionId, selectedCameraId, triggerSuccessFeedback, onScan, onError])

  // Enumerate cameras on mount
  useEffect(() => {
    let isMounted = true
    Html5Qrcode.getCameras()
      .then((devices) => {
        if (isMounted && devices && devices.length > 0) {
          setCameras(devices)
          // Prefer back/environment facing camera
          const backCam = devices.find(
            (c) =>
              c.label.toLowerCase().includes('back') ||
              c.label.toLowerCase().includes('rear') ||
              c.label.toLowerCase().includes('environment')
          )
          setSelectedCameraId(backCam ? backCam.id : devices[0].id)
        }
      })
      .catch((err) => {
        console.warn('Camera enumeration error:', err)
      })

    return () => {
      isMounted = false
      if (scannerRef.current && scannerRef.current.isScanning) {
        scannerRef.current.stop().catch(() => {})
      }
    }
  }, [])

  // Auto-start if requested and camera available
  useEffect(() => {
    if (autoStart && selectedCameraId && !isScanning && !scannerRef.current) {
      startScanning()
    }
  }, [autoStart, selectedCameraId, isScanning, startScanning])

  const stopScanning = async () => {
    if (scannerRef.current && scannerRef.current.isScanning) {
      try {
        await scannerRef.current.stop()
      } catch (err) {
        console.warn('Error stopping scanner:', err)
      }
    }
    setIsScanning(false)
  }

  const switchCamera = async () => {
    if (cameras.length <= 1) return
    await stopScanning()
    const currentIndex = cameras.findIndex((c) => c.id === selectedCameraId)
    const nextCamera = cameras[(currentIndex + 1) % cameras.length]
    setSelectedCameraId(nextCamera.id)
    // Small timeout to allow camera hardware to unbind
    setTimeout(() => {
      startScanning()
    }, 200)
  }

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const clean = manualCode.trim()
    if (!clean) return
    triggerSuccessFeedback()
    setLastScanned(clean)
    onScan(clean)
  }

  return (
    <div className={`w-full space-y-3 bg-slate-900/90 border border-slate-800 rounded-xl p-4 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-slate-200 font-medium text-sm">
          <ScanLine className="w-4 h-4 text-blue-400" />
          <span>{label}</span>
        </div>

        {/* Camera Control Actions */}
        <div className="flex items-center gap-1.5">
          {cameras.length > 1 && isScanning && (
            <button
              type="button"
              onClick={switchCamera}
              className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
              title="Switch Camera"
            >
              <SwitchCamera className="w-4 h-4" />
            </button>
          )}

          <button
            type="button"
            onClick={isScanning ? stopScanning : startScanning}
            disabled={isInitializing}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              isScanning
                ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30 hover:bg-rose-500/30'
                : 'bg-blue-600 hover:bg-blue-500 text-white shadow-sm'
            }`}
          >
            {isScanning ? (
              <>
                <CameraOff className="w-3.5 h-3.5" />
                <span>Stop</span>
              </>
            ) : (
              <>
                <Camera className="w-3.5 h-3.5" />
                <span>Scan Camera</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Error Message */}
      {scanError && (
        <div className="flex items-center gap-2 p-2.5 text-xs text-rose-400 bg-rose-950/40 border border-rose-800 rounded-lg">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{scanError}</span>
        </div>
      )}

      {/* Camera Live Viewfinder Area */}
      <div
        className={`relative overflow-hidden rounded-xl border border-slate-700 bg-black transition-all ${
          isScanning ? 'min-h-[220px]' : 'hidden'
        }`}
      >
        <div id={regionId} className="w-full h-full" />

        {/* Custom Viewfinder Reticle Overlay */}
        {isScanning && (
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
            <div className="w-64 h-32 border-2 border-dashed border-blue-400/80 rounded-lg shadow-2xl relative">
              <div className="absolute top-0 left-0 w-4 h-4 border-t-2 border-l-2 border-blue-400" />
              <div className="absolute top-0 right-0 w-4 h-4 border-t-2 border-r-2 border-blue-400" />
              <div className="absolute bottom-0 left-0 w-4 h-4 border-b-2 border-l-2 border-blue-400" />
              <div className="absolute bottom-0 right-0 w-4 h-4 border-b-2 border-r-2 border-blue-400" />
              <div className="w-full h-0.5 bg-red-500/80 shadow-[0_0_8px_red] absolute top-1/2 -translate-y-1/2 animate-pulse" />
            </div>
          </div>
        )}
      </div>

      {/* Manual Input Fallback */}
      <form onSubmit={handleManualSubmit} className="flex gap-2">
        <div className="relative flex-1">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-500">
            <Keyboard className="w-4 h-4" />
          </div>
          <input
            type="text"
            value={manualCode}
            onChange={(e) => setManualCode(e.target.value)}
            placeholder={placeholder}
            className="w-full pl-9 pr-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
          />
        </div>
        <button
          type="submit"
          disabled={!manualCode.trim()}
          className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg text-sm font-medium transition-colors disabled:opacity-40 flex items-center gap-1.5"
        >
          <span>Apply</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </form>

      {/* Last Scanned Result Pill */}
      {lastScanned && (
        <div className="flex items-center justify-between p-2.5 bg-emerald-950/40 border border-emerald-800/60 rounded-lg text-xs text-emerald-300">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>Captured:</span>
            <code className="font-mono bg-emerald-900/60 px-1.5 py-0.5 rounded text-emerald-200 font-semibold">
              {lastScanned}
            </code>
          </div>
          <button
            type="button"
            onClick={() => {
              setLastScanned(null)
              setManualCode('')
            }}
            className="text-slate-400 hover:text-slate-200 text-xs underline ml-2"
          >
            Clear
          </button>
        </div>
      )}
    </div>
  )
}
