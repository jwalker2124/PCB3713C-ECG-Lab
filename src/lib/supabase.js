import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || supabaseUrl.includes('your-project-ref')) {
  console.warn(
    '%c⚠ Supabase not configured',
    'color: orange; font-weight: bold',
    '\nAdd your keys to .env.local:\n  VITE_SUPABASE_URL=...\n  VITE_SUPABASE_ANON_KEY=...',
    '\nGet them from: supabase.com → your project → Settings → API'
  )
}

export const supabase = createClient(
  supabaseUrl  || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder-key'
)
