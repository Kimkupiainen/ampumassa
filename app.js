window.addEventListener('DOMContentLoaded', () => {
  const CLIENT_ID = '131369731464-onbrnu5hlf96r06bn2nhuas9fk1r2mmb.apps.googleusercontent.com';
const SCOPES = 'https://www.googleapis.com/auth/spreadsheets';
const SHEET_NAME = 'ampumapaivakirja';
const SHEET_TAB = 'Merkinnät';
let accessToken = null;
let spreadsheetId = null;
let editingRow = null;
let tokenClient;

function toggleDarkMode() {
  document.body.classList.toggle('dark');
}

function escapeHTML(str) {
  return str.replace(/[&<>"']/g, match => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  }[match]));
}

function saveToLocalStorage(key, value) {
  if (!value) return;
  let existing = JSON.parse(localStorage.getItem(key) || "[]");
  const normalized = existing.map(v => v.trim().toLowerCase());
  const candidate = value.trim().toLowerCase();
  if (!normalized.includes(candidate)) {
    existing.push(value.trim());
    localStorage.setItem(key, JSON.stringify(existing));
  }
}

function populateDatalist(id, key) {
  const list = document.getElementById(id);
  const items = JSON.parse(localStorage.getItem(key) || "[]");
  items.sort();
  list.innerHTML = '';
  items.forEach(val => {
    const opt = document.createElement('option');
    opt.value = val;
    list.appendChild(opt);
  });
}

function cancelEdit() {
  document.getElementById('log-form').reset();
  editingRow = null;
  document.getElementById('status').textContent = 'Muokkaus peruttu.';
}

function showLoader() {
  document.getElementById('loader').style.display = 'flex';
}

function hideLoader() {
  document.getElementById('loader').style.display = 'none';
}

function showConfirmation(row) {
  const details = `
    <p><strong>Päivämäärä:</strong> ${escapeHTML(row[0])}</p>
    <p><strong>Tapahtuma:</strong> ${escapeHTML(row[1])}</p>
    <p><strong>Ase:</strong> ${escapeHTML(row[2])} (${escapeHTML(row[3])})</p>
    <p><strong>Paikka:</strong> ${escapeHTML(row[4])}</p>
    <p><strong>Laukaukset:</strong> ${escapeHTML(row[5])}</p>
    <p><strong>Kuvaus:</strong> ${escapeHTML(row[6])}</p>
  `;
  document.getElementById('popup-details').innerHTML = details;
  document.getElementById('confirmation-popup').style.display = 'flex';
}

function closeConfirmation() {
  document.getElementById('confirmation-popup').style.display = 'none';
}

async function getSheetIdByTitle(title) {
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`, {
    headers: { Authorization: 'Bearer ' + accessToken }
  });
  const data = await res.json();
  const sheet = data.sheets.find(s => s.properties.title === title);
  return sheet?.properties?.sheetId;
}

async function findOrCreateSheet() {
  const query = \`name='\${SHEET_NAME}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false\`;
  const driveRes = await fetch(\`https://www.googleapis.com/drive/v3/files?q=\${encodeURIComponent(query)}&fields=files(id,name)\`, {
    headers: { Authorization: 'Bearer ' + accessToken }
  });
  const data = await driveRes.json();

  if (data.files?.length) {
    spreadsheetId = data.files[0].id;
    return;
  }

  const createRes = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + accessToken,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      properties: { title: SHEET_NAME },
      sheets: [{
        properties: { title: SHEET_TAB },
        data: [{
          startRow: 0,
          startColumn: 0,
          rowData: [{
            values: [
              { userEnteredValue: { stringValue: 'Päivämäärä' } },
              { userEnteredValue: { stringValue: 'Tapahtuma' } },
              { userEnteredValue: { stringValue: 'Ase' } },
              { userEnteredValue: { stringValue: 'Toimintatapa' } },
              { userEnteredValue: { stringValue: 'Paikka' } },
              { userEnteredValue: { stringValue: 'Laukaukset' } },
              { userEnteredValue: { stringValue: 'Kuvaus' } }
            ]
          }]
        }]
      }]
    })
  });
  const json = await createRes.json();
  spreadsheetId = json.spreadsheetId;
}

window.onload = () => {
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPES,
    callback: async (response) => {
      if (!response.access_token) return;
      accessToken = response.access_token;
      document.getElementById('log-form').style.display = 'block';
      document.getElementById('load-entries').style.display = 'inline';
      document.getElementById('export-pdf').style.display = 'inline';
      document.getElementById('login').innerHTML = '<p>Olet kirjautunut sisään</p>';
      await findOrCreateSheet();
      populateDatalist("weapons", "weapons");
      populateDatalist("locations", "locations");
    }
  });

  document.getElementById('login-btn').onclick = () => {
    tokenClient.requestAccessToken();
  };

  document.getElementById('log-form').addEventListener('submit', async (e) => {
    showLoader();
    e.preventDefault();
    const row = [
      date.value,
      event.value,
      weapon.value,
      tt.value,
      location.value,
      rounds.value,
      notes.value
    ];
    saveToLocalStorage("weapons", weapon.value);
    saveToLocalStorage("locations", location.value);
    if (editingRow) {
      const range = `${SHEET_TAB}!A${editingRow + 1}`;
      await fetch(\`https://sheets.googleapis.com/v4/spreadsheets/\${spreadsheetId}/values/\${range}?valueInputOption=RAW\`, {
        method: 'PUT',
        headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({ range, values: [row] })
      });
      editingRow = null;
    } else {
      await fetch(\`https://sheets.googleapis.com/v4/spreadsheets/\${spreadsheetId}/values/\${SHEET_TAB}!A1:append?valueInputOption=RAW\`, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: [row] })
      });
    }
    hideLoader();
    showConfirmation(row);
    logForm.reset();
    status.textContent = 'Merkintä tallennettu.';
  });

  document.getElementById('load-entries').onclick = async () => {
    const res = await fetch(\`https://sheets.googleapis.com/v4/spreadsheets/\${spreadsheetId}/values/\${SHEET_TAB}\`, {
      headers: { Authorization: 'Bearer ' + accessToken }
    });
    const data = await res.json();
    const rows = data.values.slice(1);
    const container = document.getElementById('entries');
    container.innerHTML = '';

    rows.forEach((r, i) => {
      const card = document.createElement('div');
      card.className = 'entry-card';

      card.innerHTML = \`
        <h3>\${r[0] || ''} – \${r[1] || ''}</h3>
        <p>Ase: \${r[2] || ''} (\${r[3] || ''})</p>
        <p>Paikka: \${r[4] || ''}</p>
        <p>Laukaukset: \${r[5] || ''}</p>
        <p><strong>Kuvaus:</strong><br>\${escapeHTML(r[6] || '')}</p>
      \`;

      const actions = document.createElement('div');
      actions.className = 'actions';
      actions.innerHTML = \`
        <button class="edit" onclick="editRow(\${i + 1})">Muokkaa</button>
        <button class="delete" onclick="deleteRow(\${i + 1})">Poista</button>
      \`;

      card.appendChild(actions);
      container.appendChild(card);
    });
  };
};

async function deleteRow(index) {
  const sheetId = await getSheetIdByTitle(SHEET_TAB);
  if (!sheetId) {
    document.getElementById('status').textContent = 'Taulukkoa ei löytynyt.';
    return;
  }
  const request = {
    requests: [{
      deleteDimension: {
        range: {
          sheetId: sheetId,
          dimension: 'ROWS',
          startIndex: index,
          endIndex: index + 1
        }
      }
    }]
  };
  await fetch(\`https://sheets.googleapis.com/v4/spreadsheets/\${spreadsheetId}:batchUpdate\`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + accessToken,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(request)
  });
  document.getElementById('status').textContent = 'Rivi poistettu.';
  document.getElementById('load-entries').click();
}

async function editRow(index) {
  const res = await fetch(\`https://sheets.googleapis.com/v4/spreadsheets/\${spreadsheetId}/values/\${SHEET_TAB}!A\${index + 1}\`, {
    headers: { Authorization: 'Bearer ' + accessToken }
  });
  const data = await res.json();
  const v = data.values[0];
  ['date', 'event', 'weapon', 'tt', 'location', 'rounds', 'notes'].forEach((id, i) => {
    document.getElementById(id).value = v[i] || '';
  });
  editingRow = index;
  document.getElementById('status').textContent = `Muokataan riviä \${index}`;
  window.scrollTo(0, 0);
}

});
