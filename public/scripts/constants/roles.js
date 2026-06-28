const TAKE_ONE_ROLES = [
  "Director",
  "Photographer",
  "Cinematographer / DP",
  "Writer",
  "Editor",
  "Sound Designer",
  "Designer",
  "Actor",
  "Producer",
  "Lighting Crew",
  "Set Support",
  "Other"
];

const ROLE_ICONS = {
  "Director": "🎬",
  "Photographer": "📸",
  "Cinematographer / DP": "📷",
  "Writer": "✍",
  "Editor": "✂",
  "Sound Designer": "🎙",
  "Designer": "🎨",
  "Actor": "🎭",
  "Producer": "📋",
  "Lighting Crew": "💡",
  "Set Support": "⚙",
  "Other": "◎"
};

const ROLE_SLUGS = TAKE_ONE_ROLES.reduce((acc, role) => {
  acc[role] = role.toLowerCase().replace(/[\s/]+/g, '-');
  return acc;
}, {});

// Fallback mapping for older database records
const LEGACY_ROLE_MAPPING = {
  "Cinematographer": "Cinematographer / DP",
  "Camera Crew": "Cinematographer / DP",
  "Sound Crew": "Sound Designer",
  "Sound": "Sound Designer",
  "Gaffer": "Lighting Crew",
  "Spot": "Set Support",
  "Spot Boy": "Set Support"
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { 
    TAKE_ONE_ROLES, 
    ROLE_ICONS, 
    ROLE_SLUGS,
    LEGACY_ROLE_MAPPING
  };
} else if (typeof window !== 'undefined') {
  window.TAKE_ONE_ROLES = TAKE_ONE_ROLES;
  window.ROLE_ICONS = ROLE_ICONS;
  window.ROLE_SLUGS = ROLE_SLUGS;
  window.LEGACY_ROLE_MAPPING = LEGACY_ROLE_MAPPING;
}
