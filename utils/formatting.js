/**
 * Formats a given name by capitalizing the first letter of each word
 * and lowercasing the remaining letters.
 */
function formatDisplayName(name) {
  if (!name || typeof name !== 'string') return name || '';
  return name
    .split(' ')
    .map(word => {
      if (!word) return '';
      return word[0].toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');
}

/**
 * Returns the canonical display name based on user's preference
 */
function getCanonicalDisplayName(user) {
  if (!user) return 'Anonymous Creator';
  const name = formatDisplayName(user.name);
  const screenName = user.screen_name || '';
  const preference = user.display_preference || 'Real Name Only';

  if (preference === 'Screen Name Only' && screenName) {
    return screenName;
  }
  if (preference === 'Both' && screenName) {
    return `${name} • ${screenName}`;
  }
  return name;
}

module.exports = {
  formatDisplayName,
  getCanonicalDisplayName
};
