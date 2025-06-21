const tableBody = document.getElementById('blacklist-table-body');

async function fetchBlacklist() {
    try {
        const response = await fetch('/api/blacklist');
        const data = await response.json();
        renderTable(data);
    } catch (error) {
        console.error('Error fetching blacklist:', error);
    }
}

function renderTable(data) {
    const fragment = document.createDocumentFragment();
    
    if (data.length === 0) {
        const row = document.createElement('tr');
        row.innerHTML = `<td colspan="2" class="px-4 py-3 text-center text-gray-500">No symbols are currently blacklisted.</td>`;
        fragment.appendChild(row);
    } else {
        data.forEach(item => {
            const row = document.createElement('tr');
            row.className = 'table-body-row';
            row.innerHTML = `
                <td class="px-4 py-3 text-sm font-bold text-blue-600">${item.symbol}</td>
                <td class="px-4 py-3 text-sm text-gray-600">${item.timeRemaining > 0 ? item.timeRemaining : 0}</td>
            `;
            fragment.appendChild(row);
        });
    }

    tableBody.innerHTML = '';
    tableBody.appendChild(fragment);
}

fetchBlacklist();
setInterval(fetchBlacklist, 5000); // Refresh every 5 seconds
