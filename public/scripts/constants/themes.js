const ROLE_THEMES = {
  "director": {
    primary: "#FF4D1A",
    primaryRgb: "255, 77, 26",
    secondary: "#E03E0F",
    secondaryRgb: "224, 62, 15",
    glow: "rgba(255, 77, 26, 0.15)"
  },
  "photographer": {
    primary: "#8B5CF6",
    primaryRgb: "139, 92, 246",
    secondary: "#7C3AED",
    secondaryRgb: "124, 58, 237",
    glow: "rgba(139, 92, 246, 0.15)"
  },
  "cinematographer": {
    primary: "#06B6D4",
    primaryRgb: "6, 182, 212",
    secondary: "#0891B2",
    secondaryRgb: "8, 145, 178",
    glow: "rgba(6, 182, 212, 0.15)"
  },
  "writer": {
    primary: "#F59E0B",
    primaryRgb: "245, 158, 11",
    secondary: "#D97706",
    secondaryRgb: "217, 119, 6",
    glow: "rgba(245, 158, 11, 0.15)"
  },
  "editor": {
    primary: "#3B82F6",
    primaryRgb: "59, 130, 246",
    secondary: "#2563EB",
    secondaryRgb: "37, 99, 235",
    glow: "rgba(59, 130, 246, 0.15)"
  },
  "sound": {
    primary: "#10B981",
    primaryRgb: "16, 185, 129",
    secondary: "#059669",
    secondaryRgb: "5, 150, 105",
    glow: "rgba(16, 185, 129, 0.15)"
  },
  "designer": {
    primary: "#EC4899",
    primaryRgb: "236, 72, 153",
    secondary: "#DB2777",
    secondaryRgb: "219, 39, 119",
    glow: "rgba(236, 72, 153, 0.15)"
  },
  "actor": {
    primary: "#A78BFA",
    primaryRgb: "167, 139, 250",
    secondary: "#8B5CF6",
    secondaryRgb: "139, 92, 246",
    glow: "rgba(167, 139, 250, 0.15)"
  },
  "producer": {
    primary: "#E11D48",
    primaryRgb: "225, 29, 72",
    secondary: "#BE123C",
    secondaryRgb: "190, 18, 60",
    glow: "rgba(225, 29, 72, 0.15)"
  },
  "lighting": {
    primary: "#EAB308",
    primaryRgb: "234, 179, 8",
    secondary: "#CA8A04",
    secondaryRgb: "202, 138, 4",
    glow: "rgba(234, 179, 8, 0.15)"
  },
  "support": {
    primary: "#64748B",
    primaryRgb: "100, 116, 139",
    secondary: "#475569",
    secondaryRgb: "71, 85, 105",
    glow: "rgba(100, 116, 139, 0.15)"
  },
  "other": {
    primary: "#FF4D1A",
    primaryRgb: "255, 77, 26",
    secondary: "#E03E0F",
    secondaryRgb: "224, 62, 15",
    glow: "rgba(255, 77, 26, 0.15)"
  }
};

function getRoleSlug(role) {
  if (!role) return 'other';
  const r = role.toLowerCase().trim();
  if (r.includes('director')) return 'director';
  if (r.includes('photographer')) return 'photographer';
  if (r.includes('cinematographer') || r.includes('dp')) return 'cinematographer';
  if (r.includes('writer')) return 'writer';
  if (r.includes('editor')) return 'editor';
  if (r.includes('sound')) return 'sound';
  if (r.includes('designer')) return 'designer';
  if (r.includes('actor')) return 'actor';
  if (r.includes('producer')) return 'producer';
  if (r.includes('lighting')) return 'lighting';
  if (r.includes('support')) return 'support';
  return 'other';
}

function applyRoleTheme(role, element) {
  const target = element || document.documentElement;
  const slug = getRoleSlug(role);
  const theme = ROLE_THEMES[slug] || ROLE_THEMES['other'];

  // Remove existing role-theme- classes from the element
  const classesToRemove = [];
  target.classList.forEach(cls => {
    if (cls.startsWith('role-theme-')) {
      classesToRemove.push(cls);
    }
  });
  classesToRemove.forEach(cls => target.classList.remove(cls));

  // Add new theme class
  target.classList.add(`role-theme-${slug}`);

  // Set CSS Custom Properties
  target.style.setProperty('--theme-primary', theme.primary);
  target.style.setProperty('--theme-primary-rgb', theme.primaryRgb);
  target.style.setProperty('--theme-secondary', theme.secondary);
  target.style.setProperty('--theme-secondary-rgb', theme.secondaryRgb);
  target.style.setProperty('--theme-glow', theme.glow);

  return slug;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    ROLE_THEMES,
    getRoleSlug,
    applyRoleTheme
  };
}

if (typeof window !== 'undefined') {
  window.ROLE_THEMES = ROLE_THEMES;
  window.getRoleSlug = getRoleSlug;
  window.applyRoleTheme = applyRoleTheme;
}
