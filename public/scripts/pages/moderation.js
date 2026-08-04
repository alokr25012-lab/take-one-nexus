/* Using escapeHTML from helpers.js */

function reportCard(report) {
  return `
    <div class="report-card">
      <div>
        <div class="report-title">${escapeHTML(report.reason)}</div>
        <div class="report-meta">
          ${escapeHTML(report.status)} · ${escapeHTML(report.target_type)}
          ${report.target_id ? `#${Number(report.target_id)}` : ''}
        </div>
        <p>${escapeHTML(report.details || 'No extra details added.')}</p>
        <p>Reported by ${escapeHTML(report.reporter_name || 'Unknown')} · ${escapeHTML(report.reporter_email || '')}</p>
        ${report.moderator_name ? `<p><strong>Moderated by:</strong> ${escapeHTML(report.moderator_name)} · ${escapeHTML(report.moderator_email || '')}</p>` : ''}
      </div>
      <div class="report-actions">
        <button type="button" onclick="updateReport(${Number(report.id)}, 'reviewing')">Reviewing</button>
        <button type="button" onclick="updateReport(${Number(report.id)}, 'resolved')">Resolve</button>
        <button type="button" onclick="updateReport(${Number(report.id)}, 'dismissed')">Dismiss</button>
      </div>
    </div>
  `;
}

async function loadReports() {
  const list = document.getElementById('reportList');
  const status = document.getElementById('statusFilter')?.value || '';

  if (!list) return;

  if (typeof API === 'undefined') {
    list.textContent = '<div class="empty">Moderation API is still loading. Refresh if this message remains.</div>';
    return;
  }

  if (!API.auth.isLoggedIn()) {
    list.innerHTML = '<div class="empty">Login as an admin or moderator to view reports.</div>';
    return;
  }

  try {
    list.innerHTML = '<div class="empty">Loading moderation reports...</div>';
    const response = await API.moderation.listReports(status);
    const reports = response.data || [];

    if (reports.length === 0) {
      list.innerHTML = '<div class="empty">No reports found for this filter.</div>';
      return;
    }

    list.innerHTML = reports.map(reportCard).join('');
  } catch (error) {
    list.innerHTML = `<div class="empty">${escapeHTML(error.message || 'Could not load moderation reports.')}</div>`;
  }
}

async function updateReport(id, status) {
  if (typeof API === 'undefined') {
    alert('Moderation API is not ready yet. Please retry.');
    return;
  }

  try {
    await API.moderation.updateReport(id, {
      status,
      moderator_notes: `Marked ${status} from moderation dashboard.`
    });
    loadReports();
  } catch (error) {
    alert(error.message || 'Could not update report');
  }
}

document.getElementById('refreshReportsBtn')?.addEventListener('click', loadReports);
document.getElementById('statusFilter')?.addEventListener('change', loadReports);
loadReports();
