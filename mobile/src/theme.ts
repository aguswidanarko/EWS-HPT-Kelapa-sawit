// Minimal shared design tokens - kept intentionally simple (no styling library) since this app
// cannot be visually verified in this sandbox; plain, predictable React Native StyleSheet values
// reduce the chance of a rendering bug slipping through unseen.
export const colors = {
  bg: '#F4F6F5',
  card: '#FFFFFF',
  border: '#DDE3E0',
  text: '#1B2420',
  textMuted: '#5B6B63',
  primary: '#1F7A4D',
  primaryDark: '#155C39',
  danger: '#C0392B',
  warning: '#D98A1E',
  success: '#2E9E5B',
  online: '#2E9E5B',
  syncing: '#D98A1E',
  offline: '#C0392B',
  chip: '#EAF3EE',
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };

export const severityColor: Record<string, string> = {
  NORMAL: '#2E9E5B',
  RINGAN: '#C9C13A',
  SEDANG: '#D98A1E',
  BERAT: '#D9531E',
  CRITICAL: '#C0392B',
};
