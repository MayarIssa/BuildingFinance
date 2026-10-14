import type { MetadataRoute } from 'next'

// Lets phones install BuildFin from "Add to Home Screen": it opens
// full-screen like an app and follows the phone's rotation
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'BuildFin — Building Finance Manager',
    short_name: 'BuildFin',
    description: "Manage your building's finances, dues, and expenses",
    start_url: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#f6f4ef',
    theme_color: '#0b7a55',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
