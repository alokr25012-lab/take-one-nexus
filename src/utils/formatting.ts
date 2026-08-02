/**
 * Formats a given name by capitalizing the first letter of each word
 * and lowercasing the remaining letters.
 * Example: 'aArUsH gUpTa' -> 'Aarush Gupta'
 */
export function formatDisplayName(name: string | null | undefined): string {
  if (!name) return '';
  return name
    .split(' ')
    .map(word => {
      if (!word) return '';
      return word[0].toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');
}

export function getCanonicalDisplayName(user: any): string {
  if (!user) return 'Unnamed Creator';
  const name = user.name || 'Anonymous Creator';
  const screenName = user.screen_name || '';
  const preference = user.display_preference || 'Real Name Only';
  
  if (preference === 'Screen Name Only' && screenName) return screenName;
  if (preference === 'Both' && screenName) return `${name} • ${screenName}`;
  return name;
}
