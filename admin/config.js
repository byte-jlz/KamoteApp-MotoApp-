// Public settings, same as the app's src/lib/config.ts. The anon key is safe to publish: database rules (RLS)
// only let an ADMIN account read riders' data, and admin changes go through the admin-users Edge Function.
// NEVER put the service_role / secret key here.
export const SUPABASE_URL = 'https://kicxomumujegcrilsszf.supabase.co';
export const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtpY3hvbXVtdWplZ2NyaWxzc3pmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA4NTA3NTUsImV4cCI6MjEwNjQyNjc1NX0.YOvg4EQCDMP0_y0XLYE8PmYKLFHhq0yhrx4yJjVOT_U';
