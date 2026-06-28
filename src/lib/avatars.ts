/**
 * EMERGENCY FALLBACK AVATAR SYSTEM
 * Disables external API dependencies (DiceBear, UI-Avatars) for maximum stability.
 */

export type Gender = 'Male' | 'Female' | 'Other' | 'Prefer not to say';

export function getAvatarUrl(name: string, gender?: string | null, customAvatar?: string | null): string {
  // Use custom avatar if provided, otherwise a local placeholder
  if (customAvatar && customAvatar.trim() !== '') {
    return customAvatar;
  }

  // RETURN STATIC LOCAL PLACEHOLDER TO AVOID EXTERNAL NETWORK CALLS DURING SSR
  // This is a simple profile SVG with explicit width/height to prevent scaling bugs
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 24 24" fill="none" stroke="#6B7A8D" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

/**
 * Helper for client-side image fallback
 */
export const handleImageError = (e: any) => {
  const target = e.target;
  target.onerror = null;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 24 24" fill="none" stroke="#6B7A8D" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>`;
  target.src = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
};
