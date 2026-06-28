/**
 * HELPER UTILITIES
 * Pure functions and data manipulators used across the application.
 */

function escapeHTML(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function formatCompactNumber(value) {
    return new Intl.NumberFormat('en-IN', {
        notation: 'compact',
        maximumFractionDigits: 1
    }).format(Number(value) || 0);
}

function splitSkills(skills) {
    return String(skills || '')
        .split(',')
        .map(item => item.trim())
        .filter(Boolean);
}

function normalizeRole(role) {
    return String(role || '').trim().toLowerCase();
}

function isCreatorRole(role) {
    const normalized = normalizeRole(role);
    return (
        normalized.includes('director') ||
        normalized.includes('writer') ||
        normalized.includes('producer') ||
        normalized.includes('screenwriter')
    );
}

function getCardTone(genre) {
    const tones = {
        horror: '#2a0808',
        romance: '#081020',
        action: '#0a1808',
        comedy: '#181408',
        thriller: '#10080a',
        drama: '#08101a',
        'sci-fi': '#08121c'
    };
    return tones[String(genre || '').toLowerCase()] || '#141018';
}

function splitCollegeCity(value) {
    const cleaned = String(value || '').trim();
    if (!cleaned) return { college: '', city: '' };

    const separator = cleaned.includes('·') ? '·' : ',';
    const parts = cleaned
        .split(separator)
        .map(part => part.trim())
        .filter(Boolean);

    return {
        college: parts[0] || '',
        city: parts.slice(1).join(` ${separator} `) || ''
    };
}

function isAdmin(user) {
    if (!user) return false;
    const secondary = String(user.secondary_role || '').toLowerCase();
    return secondary === 'admin' || secondary === 'founder';
}

function getAvatarUrl(name, gender, customAvatar) {
    // 1. Priority: Custom uploaded avatar
    if (customAvatar && customAvatar.trim() !== '') {
        return customAvatar;
    }

    const safeName = (name || 'User').trim();
    const normalizedGender = (gender || 'Other').toLowerCase();
    const seed = encodeURIComponent(safeName);

    // 2. DiceBear Avataaars options based on gender selection
    let genderOptions = '';
    
    if (normalizedGender === 'male') {
        genderOptions = '&top[]=shortHair&top[]=shaggy&top[]=shortWaved&top[]=sides&facialHairProbability=15&facialHair[]=beardLight';
    } else if (normalizedGender === 'female') {
        genderOptions = '&top[]=longHair&top[]=bob&top[]=curly&top[]=bun&facialHairProbability=0';
    } else {
        genderOptions = '&top[]=shortHair&top[]=hat&top[]=curly&top[]=eyepatch&facialHairProbability=5';
    }

    const colors = '0E1218,1C2330,FF4D1A,FFA620,00D4FF';

    return `https://api.dicebear.com/7.x/avataaars/svg?seed=${seed}${genderOptions}&backgroundColor=${colors}&mood[]=happy&backgroundType=gradientLinear`;
}

function handleImageError(img, name, gender) {
    if (img.dataset.triedFallback === 'true') return;
    img.dataset.triedFallback = 'true';
    
    const safeName = encodeURIComponent(name || 'User');
    img.src = `https://ui-avatars.com/api/?name=${safeName}&background=random&color=fff&size=128&bold=true`;
}
