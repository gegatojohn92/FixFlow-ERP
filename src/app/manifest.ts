import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'FixFlow ERP',
    short_name: 'FixFlow',
    description: 'End-to-end Job Order & MRS management for maintenance operations',
    start_url: '/dashboard',
    display: 'standalone',
    orientation: 'portrait-primary',
    background_color: '#0f172a',
    theme_color: '#1e40af',
    categories: ['business', 'productivity'],
    icons: [
      {
        src: '/icons/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
    shortcuts: [
      {
        name: 'New Job Order',
        short_name: 'New JO',
        description: 'Create a new Job Order (Form 1)',
        url: '/jo/new',
        icons: [{ src: '/icons/shortcut-jo.png', sizes: '96x96' }],
      },
      {
        name: 'New MRS',
        short_name: 'MRS',
        description: 'Submit a Material Requisition Slip',
        url: '/mrs/new',
        icons: [{ src: '/icons/shortcut-mrs.png', sizes: '96x96' }],
      },
    ],
  }
}
