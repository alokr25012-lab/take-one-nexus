/**
 * UI COMPONENTS & STATUS HELPERS
 * Toast notifications, status bar clock, and UI updates.
 */

/* ── TOAST NOTIFICATION ── */
function showToast(msg) {
    const toast = document.getElementById('toast');
    if (!toast) {
        console.warn('Toast element not found');
        return;
    }
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3000);
}

/* ── LIVE CLOCK (STATUS BAR) ── */
function updateStatusBarTime() {
    const el = document.getElementById('statusTime');
    if (!el) return;
    const t = new Date();
    el.textContent = t.toLocaleTimeString('en-IN', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
}

function updateText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

function updateStat(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

function populateRoleDropdowns() {
    if (typeof window.TAKE_ONE_ROLES === 'undefined') return;
    
    const dropdowns = [
        document.getElementById('registerRole'),
        document.getElementById('editRole')
    ];
    
    dropdowns.forEach(dropdown => {
        if (!dropdown) return;
        
        // Preserve any currently selected value if applicable
        const currentVal = dropdown.value;
        
        const roles = window.TAKE_ONE_ROLES;
        
        dropdown.innerHTML = roles.map(role => 
            `<option value="${role}">${role}</option>`
        ).join('');
        
        // If it was editing a profile and the user had a value, try to select it
        if (currentVal && roles.includes(currentVal)) {
            dropdown.value = currentVal;
        }
    });
}

// Initialization
document.addEventListener('DOMContentLoaded', () => {
    populateRoleDropdowns();
    setInterval(updateStatusBarTime, 1000);
    updateStatusBarTime();
});
