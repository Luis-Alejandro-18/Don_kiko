/* Configuración pública del ranking global (Supabase).
   Esta es una publishable key: puede ir en el frontend.
   Nunca pongas aquí la service_role key. */
window.DK_CONFIG = {
  supabaseUrl: 'https://jieweipwcehshthgyoeo.supabase.co',
  supabaseKey: 'sb_publishable_OyLDM4HXhv9jHVPG77Sr5Q_HW16jwNE',
  leaderboardLimit: 50,
  // Niveles jugables de la campaña. Debe coincidir con LEVEL_NAMES del juego.
  // Sube a 4 y 5 cuando se agreguen los niveles nuevos.
  totalLevels: 3,
  levelWidths: { 1: 1000, 2: 1580, 3: 2470 }
};
