// Public Supabase settings. The anon key is meant to ship inside the app: database rules (RLS) only let it
// read fuel data, register this phone for alerts, and let a logged-in rider reach their own records.
// Never put the service_role key here.
export const SUPABASE_URL = 'https://kicxomumujegcrilsszf.supabase.co';
export const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtpY3hvbXVtdWplZ2NyaWxzc3pmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA4NTA3NTUsImV4cCI6MjEwNjQyNjc1NX0.YOvg4EQCDMP0_y0XLYE8PmYKLFHhq0yhrx4yJjVOT_U';

// Friend QR codes hold a web link, so a phone's normal camera can open them once the public /add page exists.
// The app reads both this and motopms://add-friend/<code>.
export const FRIEND_LINK_BASE = 'https://leafy-naiad-587d1c.netlify.app/add/';
