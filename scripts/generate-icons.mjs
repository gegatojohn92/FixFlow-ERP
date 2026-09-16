import sharp from 'sharp'
import { existsSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const SRC  = join('C:\\Users\\ADMIN\\.gemini\\antigravity-ide\\brain\\432df049-ef29-49f0-b218-8076ab1f4334\\fixflow_icon_1789587999304.jpg')
const DEST = join(ROOT, 'public', 'icons')

if (!existsSync(DEST)) mkdirSync(DEST, { recursive: true })

const icons = [
  { file: 'icon-192.png',         size: 192 },
  { file: 'icon-512.png',         size: 512 },
  { file: 'icon-maskable-512.png',size: 512 },
  { file: 'shortcut-jo.png',      size: 96  },
  { file: 'shortcut-mrs.png',     size: 96  },
  { file: 'apple-touch-icon.png', size: 180 },
  { file: 'favicon-32.png',       size: 32  },
]

for (const { file, size } of icons) {
  const dest = join(DEST, file)
  await sharp(SRC)
    .resize(size, size, { fit: 'cover' })
    .png()
    .toFile(dest)
  console.log(`✅ Generated ${file} (${size}x${size})`)
}

console.log('\n🎉 All icons generated in public/icons/')
