export const USER_ROLES = [
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
] as const;

export type UserRole = (typeof USER_ROLES)[number];
