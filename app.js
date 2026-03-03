  const CLIENT_ID = '131369731464-onbrnu5hlf96r06bn2nhuas9fk1r2mmb.apps.googleusercontent.com';
  // drive.file scope added so the Drive API search in findOrCreateSheet works correctly
  const SCOPES = 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.file';
  const SHEET_NAME = 'ampumapaivakirja';
  const SHEET_TAB = 'Merkinnät';
  let accessToken = null;
  let spreadsheetId = null;
  let editingRow = null;
  let signingRowIndex = null;
  let tokenClient;

  function toggleDarkMode() {
    document.body.classList.toggle('dark');
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

  document.querySelector('.menu-toggle').onclick = () => {
    document.querySelector('.nav-links').classList.toggle('open');
  };

  function cancelEdit() {
    document.getElementById('log-form').reset();
    editingRow = null;
    document.getElementById('form-modal').style.display = 'none';
    showStatus('');
  }

  function openFormModal(title, showCancelBtn) {
    document.getElementById('form-modal-title').textContent = title;
    document.getElementById('form-cancel-btn').style.display = showCancelBtn ? 'block' : 'none';
    showStatus('');
    document.getElementById('form-modal').style.display = 'flex';
    // Focus first field after transition
    setTimeout(() => document.getElementById('date').focus(), 80);
  }

  function escapeHTML(str) {
    if (typeof str !== 'string') str = String(str);
    return str.replace(/[&<>"']/g, match => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    }[match]));
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.onload = resolve; s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  function showLoader() {
    document.getElementById('loader').style.display = 'flex';
  }

  function hideLoader() {
    document.getElementById('loader').style.display = 'none';
  }

  // Centralised status helper — red text on errors, normal otherwise
  function showStatus(msg, isError = false) {
    const el = document.getElementById('status');
    el.textContent = msg;
    el.style.color = isError ? '#e74c3c' : '';
  }

  // Called when a 401 comes back from any API request
  function handleTokenExpiry() {
    accessToken = null;
    document.body.classList.remove('logged-in');
    document.getElementById('form-modal').style.display = 'none';
    document.getElementById('stats-bar').style.display = 'none';
    document.getElementById('entry-cards').innerHTML = '';
    document.getElementById('login-btn').style.display = 'inline';
    document.getElementById('login').innerHTML = '<p>Istunto vanhentunut. Kirjaudu uudelleen.</p>';
    hideLoader();
    document.getElementById('global-loader').style.display = 'none';
  }

  // Fetch wrapper: injects auth header, detects 401 (expired token) and other errors
  async function apiFetch(url, options = {}) {
    const res = await fetch(url, {
      ...options,
      headers: {
        Authorization: 'Bearer ' + accessToken,
        ...(options.headers || {})
      }
    });
    if (res.status === 401) {
      handleTokenExpiry();
      throw new Error('TOKEN_EXPIRED');
    }
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`API error ${res.status}: ${errText}`);
    }
    return res.json();
  }

  function showConfirmation(row) {
    const details = `
      <p><strong>Päivämäärä:</strong> ${escapeHTML(row[0])}</p>
      <p><strong>Tapahtuma:</strong> ${escapeHTML(row[1])}</p>
      <p><strong>Asetyyppi:</strong> ${escapeHTML(row[2])}</p>
      <p><strong>Kaliiperi:</strong> ${escapeHTML(row[3])}</p>
      <p><strong>Ase:</strong> ${escapeHTML(row[4])} (${escapeHTML(row[5])})</p>
      <p><strong>Paikka:</strong> ${escapeHTML(row[6])}</p>
      <p><strong>Laukaukset:</strong> ${escapeHTML(row[7])}</p>
      <p><strong>Kuvaus:</strong> ${escapeHTML(row[8])}</p>
    `;
    document.getElementById('popup-details').innerHTML = details;
    document.getElementById('confirmation-modal').style.display = 'flex';
    document.getElementById('close-modal').focus();
  }

  document.getElementById('close-modal').addEventListener('click', () => {
    document.getElementById('confirmation-modal').style.display = 'none';
  });

  // Returns the internal numeric sheetId for a tab by its title
  async function getSheetIdByTitle(title) {
    const data = await apiFetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`);
    const sheet = data.sheets.find(s => s.properties.title === title);
    return sheet?.properties?.sheetId;
  }

  async function findOrCreateSheet() {
    const storedId = localStorage.getItem('ampuma_sheet_id');
    if (storedId) {
      spreadsheetId = storedId;
      await createOrUpdateRaporttiSheet();
      await applyDateFormatting();
      return;
    }

    // drive.file scope is now requested so this query works for new users / new devices
    const query = `name='${SHEET_NAME}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`;
    const data = await apiFetch(
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name)`
    );

    if (data.files?.length) {
      spreadsheetId = data.files[0].id;
      localStorage.setItem('ampuma_sheet_id', spreadsheetId);
      await createOrUpdateRaporttiSheet();
      await applyDateFormatting();
      return;
    }

    // No existing sheet found — create a new one
    const json = await apiFetch('https://sheets.googleapis.com/v4/spreadsheets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
                { userEnteredValue: { stringValue: 'Asetyyppi' } },
                { userEnteredValue: { stringValue: 'Kaliiperi' } },
                { userEnteredValue: { stringValue: 'Ase' } },
                { userEnteredValue: { stringValue: 'Toimintatapa' } },
                { userEnteredValue: { stringValue: 'Paikka' } },
                { userEnteredValue: { stringValue: 'Laukaukset' } },
                { userEnteredValue: { stringValue: 'Kuvaus' } },
                { userEnteredValue: { stringValue: 'Allekirjoitus' } }
              ]
            }]
          }]
        }]
      })
    });

    spreadsheetId = json.spreadsheetId;
    localStorage.setItem('ampuma_sheet_id', spreadsheetId);
    await createOrUpdateRaporttiSheet();
    await applyDateFormatting();
  }

  async function applyDateFormatting() {
    const sheetId = await getSheetIdByTitle(SHEET_TAB);
    if (!sheetId) return;
    await apiFetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: [{
          repeatCell: {
            range: { sheetId, startColumnIndex: 0, endColumnIndex: 1 },
            cell: { userEnteredFormat: { numberFormat: { type: "DATE", pattern: "yyyy-mm-dd" } } },
            fields: "userEnteredFormat.numberFormat"
          }
        }]
      })
    });
  }

  // Creates the Raportti tab if missing, then always writes the correct formulas.
  // This also fixes existing spreadsheets that had the wrong column references
  // (D instead of F for Toimintatapa, F instead of H for Laukaukset).
  //
  // Column layout:
  //   A=Päivämäärä  B=Tapahtuma  C=Asetyyppi  D=Kaliiperi  E=Ase
  //   F=Toimintatapa  G=Paikka  H=Laukaukset  I=Kuvaus
  async function createOrUpdateRaporttiSheet() {
    const meta = await apiFetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`);
    const existingSheet = meta.sheets.find(s => s.properties.title === "Raportti");
    let raporttiSheetId;

    if (existingSheet) {
      raporttiSheetId = existingSheet.properties.sheetId;
    } else {
      const addSheetData = await apiFetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ requests: [{ addSheet: { properties: { title: "Raportti" } } }] })
        }
      );
      raporttiSheetId = addSheetData.replies?.[0]?.addSheet?.properties?.sheetId;
      if (!raporttiSheetId) {
        console.error("Raportti-välilehden luonti epäonnistui.");
        return;
      }
    }

    // Write correct formulas every login so stale/wrong formulas get fixed automatically
    const values = [
      {
        values: [
          { userEnteredValue: { stringValue: "Toimintatapa" } },
          { userEnteredValue: { stringValue: "1v Käynnit" } },
          { userEnteredValue: { stringValue: "1v Laukaukset" } },
          { userEnteredValue: { stringValue: "2v Käynnit" } },
          { userEnteredValue: { stringValue: "2v Laukaukset" } }
        ]
      },
      ...["TT1", "TT2", "TT3", "TT4"].map(tt => ({
        values: [
          { userEnteredValue: { stringValue: tt } },
          // F:F = Toimintatapa (was wrongly D:D), H:H = Laukaukset (was wrongly F:F)
          { userEnteredValue: { formulaValue: `=COUNTIFS(Merkinnät!F:F,"${tt}",Merkinnät!A:A,">"&TODAY()-365)` } },
          { userEnteredValue: { formulaValue: `=SUMIFS(Merkinnät!H:H,Merkinnät!F:F,"${tt}",Merkinnät!A:A,">"&TODAY()-365)` } },
          { userEnteredValue: { formulaValue: `=COUNTIFS(Merkinnät!F:F,"${tt}",Merkinnät!A:A,">"&TODAY()-730)` } },
          { userEnteredValue: { formulaValue: `=SUMIFS(Merkinnät!H:H,Merkinnät!F:F,"${tt}",Merkinnät!A:A,">"&TODAY()-730)` } }
        ]
      }))
    ];

    await apiFetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: [{
          updateCells: {
            rows: values,
            fields: "userEnteredValue",
            start: { sheetId: raporttiSheetId, rowIndex: 0, columnIndex: 0 }
          }
        }]
      })
    });
  }

  // Helper that builds the edit/delete/sign action buttons for a card.
  // Kept as a function so they can be recreated if a failed delete needs to be undone.
  function createCardActions(rowIndex, cardElement) {
    const actions = document.createElement('div');
    actions.className = 'actions';

    const editBtn = document.createElement('button');
    editBtn.className = 'edit';
    editBtn.textContent = 'Muokkaa';
    editBtn.onclick = () => editRow(rowIndex);
    actions.appendChild(editBtn);

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'delete';
    deleteBtn.textContent = 'Poista';
    deleteBtn.onclick = () => deleteRow(rowIndex, cardElement);
    actions.appendChild(deleteBtn);

    const signBtn = document.createElement('button');
    signBtn.className = 'sign';
    signBtn.textContent = '✍ Allekirjoita';
    signBtn.onclick = () => openSignatureModal(rowIndex, cardElement);
    actions.appendChild(signBtn);

    return actions;
  }

  window.onload = () => {
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPES,
      callback: async (response) => {
        document.getElementById('login-btn').style.display = 'none';
        showLoader();
        if (!response.access_token) {
          hideLoader();
          document.getElementById('login-btn').style.display = 'inline';
          return;
        }
        accessToken = response.access_token;
        try {
          await findOrCreateSheet();
          document.body.classList.add('logged-in');
          document.getElementById('tools-panel').setAttribute('open', '');
          document.getElementById('login').innerHTML = '<p>Olet kirjautunut sisään</p>';
          populateDatalist("weapons", "weapons");
          populateDatalist("locations", "locations");
          populateDatalist("calibers", "calibers");
          // Auto-fill today's date and load entries + stats on login
          const today = new Date().toISOString().split('T')[0];
          document.getElementById('date').value = today;
          loadEntries();
        } catch (err) {
          if (err.message !== 'TOKEN_EXPIRED') {
            showStatus('Kirjautuminen epäonnistui. Yritä uudelleen.', true);
            document.getElementById('login-btn').style.display = 'inline';
          }
        } finally {
          hideLoader();
        }
      }
    });

    document.getElementById('login-btn').onclick = () => {
      tokenClient.requestAccessToken();
    };

    document.getElementById('log-form').addEventListener('submit', async (e) => {
      showLoader();
      e.preventDefault();

      const dateInput = document.getElementById('date').value;
      const excelDate = (new Date(dateInput) - new Date("1899-12-30")) / (1000 * 60 * 60 * 24);

      const row = [
        { userEnteredValue: { numberValue: excelDate }, userEnteredFormat: { numberFormat: { type: "DATE", pattern: "yyyy-mm-dd" } } },
        { userEnteredValue: { stringValue: document.getElementById('event').value } },
        { userEnteredValue: { stringValue: document.getElementById('type').value } },
        { userEnteredValue: { stringValue: document.getElementById('caliber').value } },
        { userEnteredValue: { stringValue: document.getElementById('weapon').value } },
        { userEnteredValue: { stringValue: document.getElementById('tt').value } },
        { userEnteredValue: { stringValue: document.getElementById('location').value } },
        { userEnteredValue: { numberValue: Number(document.getElementById('rounds').value) } },
        { userEnteredValue: { stringValue: document.getElementById('notes').value } }
      ];

      saveToLocalStorage("weapons", document.getElementById('weapon').value);
      saveToLocalStorage("locations", document.getElementById('location').value);
      saveToLocalStorage("calibers", document.getElementById('caliber').value);

      try {
        const sheetId = await getSheetIdByTitle(SHEET_TAB);
        if (!sheetId) {
          showStatus('Taulukkoa ei löytynyt.', true);
          hideLoader();
          return;
        }

        let rowIndex;
        if (editingRow) {
          rowIndex = editingRow;
          editingRow = null;
        } else {
          const data = await apiFetch(
            `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${SHEET_TAB}!A:A`
          );
          rowIndex = (data.values?.length || 1);
        }

        await apiFetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requests: [{
              updateCells: {
                start: { sheetId, rowIndex, columnIndex: 0 },
                rows: [{ values: row }],
                fields: "*"
              }
            }]
          })
        });

        document.getElementById('form-modal').style.display = 'none';
        showConfirmation(row.map(c => c.userEnteredValue?.stringValue ?? c.userEnteredValue?.numberValue ?? ''));
        document.getElementById('log-form').reset();
        document.getElementById('date').value = new Date().toISOString().split('T')[0];
        showStatus('Merkintä tallennettu.');
        loadEntries();
      } catch (err) {
        if (err.message !== 'TOKEN_EXPIRED') {
          showStatus('Tallennus epäonnistui. Tarkista verkkoyhteytesi ja yritä uudelleen.', true);
        }
      } finally {
        hideLoader();
      }
    });

    window.loadEntries = async function () {
      document.getElementById('global-loader').style.display = 'flex';
      try {
        const data = await apiFetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${SHEET_TAB}`
        );

        const allRows = (data.values || []).slice(1);
        const rowsWithIndex = allRows.map((row, i) => ({ data: row, rowIndex: i + 1 }));

        // ── Stats ───────────────────────────────────────────────────
        const now = new Date();
        const yearStart = new Date(now.getFullYear(), 0, 1);
        const yearRows = allRows.filter(r => new Date(r[0]) >= yearStart);
        const yearRounds = yearRows.reduce((s, r) => s + (parseInt(r[7]) || 0), 0);
        const ttCounts = {};
        yearRows.forEach(r => { const tt = r[5] || 'Muu'; ttCounts[tt] = (ttCounts[tt] || 0) + 1; });
        const ttSummary = Object.entries(ttCounts)
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([tt, n]) => `${escapeHTML(tt)}: ${n}`)
          .join(' · ');
        const statsBar = document.getElementById('stats-bar');
        statsBar.style.display = 'block';
        statsBar.innerHTML = `
          <div class="stats-main">
            <span class="stats-year">${now.getFullYear()}</span>
            <span class="stats-num">${yearRows.length}</span><span class="stats-label">käyntiä</span>
            <span class="stats-num">${yearRounds.toLocaleString('fi-FI')}</span><span class="stats-label">laukausta</span>
          </div>
          ${ttSummary ? `<div class="stats-tt">${ttSummary}</div>` : ''}
        `;

        // Newest first
        rowsWithIndex.sort((a, b) => new Date(b.data[0]) - new Date(a.data[0]));

        const container = document.getElementById('entry-cards');
        container.innerHTML = '';

        rowsWithIndex.forEach(({ data: r, rowIndex }) => {
          // Column layout: r[0]=date r[1]=event r[2]=type r[3]=caliber
          //                r[4]=weapon r[5]=tt r[6]=location r[7]=rounds r[8]=notes
          const card = document.createElement('div');
          card.className = 'entry-card';

          const title = document.createElement('h3');
          title.textContent = `${r[0] || ''} – ${r[1] || ''}`;
          card.appendChild(title);

          const weaponInfo = document.createElement('p');
          weaponInfo.textContent = `Ase: ${r[4] || ''} | ${r[2] || ''} ${r[3] || ''} | ${r[5] || ''}`;
          card.appendChild(weaponInfo);

          const location = document.createElement('p');
          location.textContent = `Paikka: ${r[6] || ''}`;
          card.appendChild(location);

          const rounds = document.createElement('p');
          rounds.textContent = `Laukaukset: ${r[7] || ''}`;
          card.appendChild(rounds);

          if (r[8]) {
            const notes = document.createElement('p');
            const label = document.createElement('strong');
            label.textContent = 'Kuvaus:';
            notes.appendChild(label);
            notes.appendChild(document.createElement('br'));
            notes.appendChild(document.createTextNode(r[8]));
            card.appendChild(notes);
          }

          if (r[9]) {
            const sigDisplay = document.createElement('div');
            sigDisplay.className = 'sig-display';
            const badge = document.createElement('span');
            badge.className = 'signed-badge';
            badge.textContent = '✍ Allekirjoitettu';
            sigDisplay.appendChild(badge);
            const sigImg = document.createElement('img');
            sigImg.src = r[9];
            sigImg.className = 'sig-image';
            sigImg.alt = 'Allekirjoitus';
            sigDisplay.appendChild(sigImg);
            card.appendChild(sigDisplay);
          }

          card.appendChild(createCardActions(rowIndex, card));
          container.appendChild(card);
        });
      } catch (err) {
        if (err.message !== 'TOKEN_EXPIRED') {
          showStatus('Merkintöjen lataus epäonnistui. Tarkista verkkoyhteytesi.', true);
        }
      } finally {
        document.getElementById('global-loader').style.display = 'none';
      }
    };

    document.getElementById('load-entries').onclick = loadEntries;

    // ── Signature modal ──────────────────────────────────────────────
    const sigModal = document.getElementById('signature-modal');
    const sigCanvas = document.getElementById('signature-canvas');
    const sigCtx = sigCanvas.getContext('2d');
    let isDrawing = false;

    function clearSigCanvas() {
      sigCtx.fillStyle = '#fff';
      sigCtx.fillRect(0, 0, sigCanvas.width, sigCanvas.height);
      sigCtx.strokeStyle = '#1a1a1a';
      sigCtx.lineWidth = 2;
      sigCtx.lineCap = 'round';
      sigCtx.lineJoin = 'round';
    }

    function getSigPos(e) {
      const rect = sigCanvas.getBoundingClientRect();
      const src = e.touches ? e.touches[0] : e;
      return {
        x: (src.clientX - rect.left) * (sigCanvas.width / rect.width),
        y: (src.clientY - rect.top) * (sigCanvas.height / rect.height)
      };
    }

    sigCanvas.addEventListener('mousedown', e => {
      isDrawing = true;
      sigCtx.beginPath();
      const p = getSigPos(e);
      sigCtx.moveTo(p.x, p.y);
    });
    sigCanvas.addEventListener('mousemove', e => {
      if (!isDrawing) return;
      const p = getSigPos(e);
      sigCtx.lineTo(p.x, p.y);
      sigCtx.stroke();
    });
    sigCanvas.addEventListener('mouseup', () => { isDrawing = false; });
    sigCanvas.addEventListener('mouseleave', () => { isDrawing = false; });

    sigCanvas.addEventListener('touchstart', e => {
      e.preventDefault();
      isDrawing = true;
      sigCtx.beginPath();
      const p = getSigPos(e);
      sigCtx.moveTo(p.x, p.y);
    }, { passive: false });
    sigCanvas.addEventListener('touchmove', e => {
      e.preventDefault();
      if (!isDrawing) return;
      const p = getSigPos(e);
      sigCtx.lineTo(p.x, p.y);
      sigCtx.stroke();
    }, { passive: false });
    sigCanvas.addEventListener('touchend', () => { isDrawing = false; });

    window.openSignatureModal = function(rowIndex) {
      signingRowIndex = rowIndex;
      clearSigCanvas();
      sigModal.style.display = 'flex';
    };

    document.getElementById('sig-clear').onclick = clearSigCanvas;

    document.getElementById('sig-cancel').onclick = () => {
      sigModal.style.display = 'none';
      signingRowIndex = null;
    };

    document.getElementById('sig-save').onclick = async () => {
      const dataUrl = sigCanvas.toDataURL('image/png');
      sigModal.style.display = 'none';
      showLoader();
      try {
        const sheetId = await getSheetIdByTitle(SHEET_TAB);
        if (!sheetId) { showStatus('Taulukkoa ei löytynyt.', true); return; }

        await apiFetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requests: [{
              updateCells: {
                start: { sheetId, rowIndex: signingRowIndex, columnIndex: 9 },
                rows: [{ values: [{ userEnteredValue: { stringValue: dataUrl } }] }],
                fields: 'userEnteredValue'
              }
            }]
          })
        });

        showStatus('Allekirjoitus tallennettu.');
        loadEntries();
      } catch (err) {
        if (err.message !== 'TOKEN_EXPIRED') {
          showStatus('Allekirjoituksen tallennus epäonnistui.', true);
        }
      } finally {
        hideLoader();
        signingRowIndex = null;
      }
    };

    // ── FAB + form-modal handlers ────────────────────────────────────
    document.getElementById('fab-add').onclick = () => {
      document.getElementById('log-form').reset();
      editingRow = null;
      const today = new Date().toISOString().split('T')[0];
      document.getElementById('date').value = today;
      openFormModal('Uusi merkintä', false);
    };

    document.getElementById('form-modal-close').onclick = cancelEdit;
    document.getElementById('form-cancel-btn').onclick = cancelEdit;

    // Click outside modal content closes it
    document.getElementById('form-modal').addEventListener('click', (e) => {
      if (e.target === document.getElementById('form-modal')) cancelEdit();
    });

    // Escape key closes form modal
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && document.getElementById('form-modal').style.display === 'flex') {
        cancelEdit();
      }
    });
  };

  window.editRow = async (index) => {
    try {
      const data = await apiFetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${SHEET_TAB}!A${index + 1}:I${index + 1}`
      );
      const v = data.values?.[0] || [];

      ['date', 'event', 'type', 'caliber', 'weapon', 'tt', 'location', 'rounds', 'notes'].forEach((id, i) => {
        const el = document.getElementById(id);
        let value = (v[i] !== undefined ? v[i] : '');
        if (id === 'date' && value.includes('/')) {
          value = value.split('/').reverse().join('-');
        }
        el.value = value;
      });

      editingRow = index;
      openFormModal('Muokkaa merkintää', true);
    } catch (err) {
      if (err.message !== 'TOKEN_EXPIRED') {
        showStatus('Rivin lataus epäonnistui.', true);
      }
    }
  };

  window.deleteRow = async function (index, cardElement) {
    if (!confirm('Haluatko varmasti poistaa tämän merkinnän? Toimintoa ei voi peruuttaa.')) return;

    const actionsDiv = cardElement.querySelector('.actions');
    cardElement.style.opacity = '0.5';
    actionsDiv.innerHTML = '<em>Poistetaan...</em>';

    const restoreCard = () => {
      cardElement.style.opacity = '1';
      actionsDiv.replaceWith(createCardActions(index, cardElement));
    };

    try {
      const sheetId = await getSheetIdByTitle(SHEET_TAB);
      if (!sheetId) {
        showStatus('Taulukkoa ei löytynyt.', true);
        restoreCard();
        return;
      }

      await apiFetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [{
            deleteDimension: {
              range: { sheetId, dimension: 'ROWS', startIndex: index, endIndex: index + 1 }
            }
          }]
        })
      });

      cardElement.remove();
      showStatus('Rivi poistettu.');
    } catch (err) {
      restoreCard();
      if (err.message !== 'TOKEN_EXPIRED') {
        showStatus('Poisto epäonnistui. Tarkista verkkoyhteytesi.', true);
      }
    }
  };

  document.getElementById('export-pdf').onclick = async () => {
    try {
      const data = await apiFetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${SHEET_TAB}`
      );
      const rows = data.values || [];

      const { jsPDF } = window.jspdf;
      const doc = new jsPDF();
      const lineHeight = 5.5;
      let y = 20;

      doc.setFontSize(16);
      doc.text("Ampumapäiväkirja", 10, 15);
      doc.setFontSize(10);

      for (let i = 1; i < rows.length; i++) {
        const [date, event, type, caliber, weapon, tt, location, rounds, notes = "", signature = ""] = rows[i];

        const block = [
          `${date} — ${event}`,
          `${weapon} (${type}, ${caliber}, ${tt}) @ ${location} | ${rounds} laukausta`,
          `Huomiot: ${notes || "-"}`
        ];

        for (let line of block) {
          const split = doc.splitTextToSize(line, 180);
          doc.text(split, 10, y);
          y += split.length * lineHeight;
        }

        if (signature) {
          if (y + 30 > 270) { doc.addPage(); y = 20; }
          doc.setFontSize(8);
          doc.text('Allekirjoitus:', 10, y);
          y += 4;
          doc.setFontSize(10);
          try { doc.addImage(signature, 'PNG', 10, y, 70, 22); } catch (e) { /* skip */ }
          y += 25;
        }

        y += 5;

        if (y > 270) {
          doc.addPage();
          y = 20;
        }
      }

      doc.save("ampumapaivakirja.pdf");
    } catch (err) {
      if (err.message !== 'TOKEN_EXPIRED') {
        console.error('PDF export error:', err);
        showStatus('PDF-vienti epäonnistui. Tarkista verkkoyhteytesi.', true);
      }
    }
  };

  document.getElementById('export-pistol-report').onclick = async () => {
    try {
      const data = await apiFetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${SHEET_TAB}`
      );
      const rows = data.values || [];

      const now = new Date();
      const twoYearsAgo = new Date();
      twoYearsAgo.setFullYear(now.getFullYear() - 2);

      const { jsPDF } = window.jspdf;
      const doc = new jsPDF();
      const lineHeight = 5.5;
      let y = 20;

      const formatDate = (d) => d.toISOString().split("T")[0];

      doc.setFontSize(16);
      doc.text("Pistooliraportti – 2v", 10, 15);
      doc.setFontSize(10);
      doc.text(`Ajanjakso: ${formatDate(twoYearsAgo)} – ${formatDate(now)}`, 10, y);
      y += 7;

      // r[2] is Asetyyppi, r[7] is Laukaukset
      const pistolRows = rows.slice(1).filter(row => {
        const date = new Date(row[0]);
        return !isNaN(date) && date >= twoYearsAgo && row[2]?.toLowerCase() === 'pistooli';
      });

      let totalRounds = 0;
      pistolRows.forEach(r => { totalRounds += parseInt(r[7]) || 0; });

      doc.text(`Käyntejä: ${pistolRows.length}`, 10, y);
      y += 5;
      doc.text(`Laukauksia yhteensä: ${totalRounds}`, 10, y);
      y += 10;

      pistolRows.forEach(r => {
        const [date, event, type, caliber, weapon, tt, location, rounds, notes = "", signature = ""] = r;

        const block = [
          `${date} — ${event}`,
          `${weapon} (${type}, ${caliber}, ${tt}) @ ${location} | ${rounds} laukausta`,
          `Huomiot: ${notes || "-"}`
        ];

        for (let line of block) {
          const split = doc.splitTextToSize(line, 180);
          doc.text(split, 10, y);
          y += split.length * lineHeight;
        }

        if (signature) {
          if (y + 30 > 270) { doc.addPage(); y = 20; }
          doc.setFontSize(8);
          doc.text('Allekirjoitus:', 10, y);
          y += 4;
          doc.setFontSize(10);
          try { doc.addImage(signature, 'PNG', 10, y, 70, 22); } catch (e) { /* skip */ }
          y += 25;
        }

        y += 5;

        if (y > 270) {
          doc.addPage();
          y = 20;
        }
      });

      doc.save("pistooliraportti_2v.pdf");
    } catch (err) {
      if (err.message !== 'TOKEN_EXPIRED') {
        console.error('Pistol report export error:', err);
        showStatus('Raportin vienti epäonnistui. Tarkista verkkoyhteytesi.', true);
      }
    }
  };

  document.getElementById('export-renewal-report').onclick = () => {
    document.getElementById('renewal-modal').style.display = 'flex';
  };

  document.getElementById('renewal-cancel').onclick = () => {
    document.getElementById('renewal-modal').style.display = 'none';
  };

  document.getElementById('renewal-ok').onclick = async () => {
    const selectedWeapons = [...document.querySelectorAll('input[name="renewal-weapon"]:checked')].map(cb => cb.value);
    const selectedTTs    = [...document.querySelectorAll('input[name="renewal-tt"]:checked')].map(cb => cb.value);

    if (selectedWeapons.length === 0) {
      showStatus('Valitse vähintään yksi asetyyppi.', true);
      return;
    }
    if (selectedTTs.length === 0) {
      showStatus('Valitse vähintään yksi toimintatapa.', true);
      return;
    }

    document.getElementById('renewal-modal').style.display = 'none';

    try {
      const data = await apiFetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${SHEET_TAB}`
      );
      const rows = data.values || [];

      const now = new Date();
      const twelveMonthsAgo = new Date();
      twelveMonthsAgo.setFullYear(now.getFullYear() - 1);

      const { jsPDF } = window.jspdf;
      const doc = new jsPDF();
      const lineHeight = 5.5;
      let y = 20;

      const formatDate = (d) => d.toISOString().split("T")[0];
      const ttLabel     = selectedTTs.join(', ');
      const weaponLabel = selectedWeapons.join(', ');

      doc.setFontSize(16);
      doc.text(`Uusintaraportti – 12 kk`, 10, 15);
      doc.setFontSize(10);
      doc.text(`Ajanjakso: ${formatDate(twelveMonthsAgo)} – ${formatDate(now)}`, 10, y); y += 5;
      doc.text(`Asetyypit: ${weaponLabel}`, 10, y); y += 5;
      doc.text(`Toimintatavat: ${ttLabel}`, 10, y); y += 10;

      // One section per selected weapon type
      selectedWeapons.forEach(weaponType => {
        const sectionRows = rows.slice(1).filter(r => {
          const d = new Date(r[0]);
          return !isNaN(d) && d >= twelveMonthsAgo
            && r[2]?.toLowerCase() === weaponType.toLowerCase()
            && selectedTTs.includes(r[5]);
        });
        const totalRounds = sectionRows.reduce((s, r) => s + (parseInt(r[7]) || 0), 0);

        if (y > 250) { doc.addPage(); y = 20; }

        doc.setFont('helvetica', 'bold');
        doc.text(`${weaponType} – käyntejä: ${sectionRows.length} | laukauksia: ${totalRounds}`, 10, y);
        doc.setFont('helvetica', 'normal');
        y += 8;

        if (sectionRows.length === 0) {
          doc.text('Ei merkintöjä valituilla suodattimilla viimeisen 12 kk ajalta.', 10, y);
          y += 7;
          return;
        }

        sectionRows.forEach(r => {
          const [date, event, type, caliber, weapon, tt, location, rounds, notes = "", signature = ""] = r;

          const block = [
            `${date} — ${event}`,
            `${weapon} (${type}, ${caliber}, ${tt}) @ ${location} | ${rounds} laukausta`,
            `Huomiot: ${notes || "-"}`
          ];

          for (let line of block) {
            const split = doc.splitTextToSize(line, 180);
            doc.text(split, 10, y);
            y += split.length * lineHeight;
          }

          if (signature) {
            if (y + 30 > 270) { doc.addPage(); y = 20; }
            doc.setFontSize(8);
            doc.text('Allekirjoitus:', 10, y);
            y += 4;
            doc.setFontSize(10);
            try { doc.addImage(signature, 'PNG', 10, y, 70, 22); } catch (e) { /* skip */ }
            y += 25;
          }

          y += 5;
          if (y > 270) { doc.addPage(); y = 20; }
        });

        y += 5; // gap between sections
      });

      const safeWeapons = selectedWeapons.map(w => w.toLowerCase().replace(/\s+/g, '_')).join('-');
      doc.save(`uusintaraportti_${safeWeapons}_${selectedTTs.join('-').toLowerCase()}_12kk.pdf`);
    } catch (err) {
      if (err.message !== 'TOKEN_EXPIRED') {
        console.error('Renewal report export error:', err);
        showStatus('Raportin vienti epäonnistui. Tarkista verkkoyhteytesi.', true);
      }
    }
  };

  document.getElementById('export-custom-report').onclick = () => {
    const today = new Date().toISOString().split('T')[0];
    const yearAgo = new Date();
    yearAgo.setFullYear(yearAgo.getFullYear() - 1);
    document.getElementById('custom-date-from').value = yearAgo.toISOString().split('T')[0];
    document.getElementById('custom-date-to').value = today;
    document.getElementById('custom-modal').style.display = 'flex';
  };

  document.getElementById('custom-cancel').onclick = () => {
    document.getElementById('custom-modal').style.display = 'none';
  };

  document.getElementById('custom-ok').onclick = async () => {
    const dateFrom = document.getElementById('custom-date-from').value;
    const dateTo   = document.getElementById('custom-date-to').value;
    const selectedWeapons = [...document.querySelectorAll('input[name="custom-weapon"]:checked')].map(cb => cb.value);
    const selectedTTs     = [...document.querySelectorAll('input[name="custom-tt"]:checked')].map(cb => cb.value);

    if (!dateFrom || !dateTo) {
      showStatus('Valitse aikaväli.', true);
      return;
    }
    if (new Date(dateFrom) > new Date(dateTo)) {
      showStatus('Alkupäivä ei voi olla loppupäivän jälkeen.', true);
      return;
    }
    if (selectedWeapons.length === 0) {
      showStatus('Valitse vähintään yksi asetyyppi.', true);
      return;
    }
    if (selectedTTs.length === 0) {
      showStatus('Valitse vähintään yksi toimintatapa.', true);
      return;
    }

    document.getElementById('custom-modal').style.display = 'none';

    try {
      const data = await apiFetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${SHEET_TAB}`
      );
      const rows = data.values || [];

      const from = new Date(dateFrom);
      const to   = new Date(dateTo);
      to.setHours(23, 59, 59, 999);

      const { jsPDF } = window.jspdf;
      const doc = new jsPDF();
      const lineHeight = 5.5;
      let y = 20;

      doc.setFontSize(16);
      doc.text('Oma raportti', 10, 15);
      doc.setFontSize(10);
      doc.text(`Ajanjakso: ${dateFrom} \u2013 ${dateTo}`, 10, y); y += 5;
      doc.text(`Asetyypit: ${selectedWeapons.join(', ')}`, 10, y); y += 5;
      doc.text(`Toimintatavat: ${selectedTTs.join(', ')}`, 10, y); y += 10;

      selectedWeapons.forEach(weaponType => {
        const sectionRows = rows.slice(1).filter(r => {
          const d = new Date(r[0]);
          return !isNaN(d) && d >= from && d <= to
            && r[2]?.toLowerCase() === weaponType.toLowerCase()
            && selectedTTs.includes(r[5]);
        });
        const totalRounds = sectionRows.reduce((s, r) => s + (parseInt(r[7]) || 0), 0);

        if (y > 250) { doc.addPage(); y = 20; }

        doc.setFont('helvetica', 'bold');
        doc.text(`${weaponType} \u2013 k\u00e4yntej\u00e4: ${sectionRows.length} | laukauksia: ${totalRounds}`, 10, y);
        doc.setFont('helvetica', 'normal');
        y += 8;

        if (sectionRows.length === 0) {
          doc.text('Ei merkint\u00f6j\u00e4 valituilla suodattimilla.', 10, y);
          y += 7;
          return;
        }

        sectionRows.forEach(r => {
          const [date, event, type, caliber, weapon, tt, location, rounds, notes = "", signature = ""] = r;

          const block = [
            `${date} \u2014 ${event}`,
            `${weapon} (${type}, ${caliber}, ${tt}) @ ${location} | ${rounds} laukausta`,
            `Huomiot: ${notes || "-"}`
          ];

          for (let line of block) {
            const split = doc.splitTextToSize(line, 180);
            doc.text(split, 10, y);
            y += split.length * lineHeight;
          }

          if (signature) {
            if (y + 30 > 270) { doc.addPage(); y = 20; }
            doc.setFontSize(8);
            doc.text('Allekirjoitus:', 10, y);
            y += 4;
            doc.setFontSize(10);
            try { doc.addImage(signature, 'PNG', 10, y, 70, 22); } catch (e) { /* skip */ }
            y += 25;
          }

          y += 5;
          if (y > 270) { doc.addPage(); y = 20; }
        });

        y += 5;
      });

      const safeWeapons = selectedWeapons.map(w => w.toLowerCase().replace(/\s+/g, '_')).join('-');
      doc.save(`oma_raportti_${dateFrom}_${dateTo}_${safeWeapons}.pdf`);
    } catch (err) {
      if (err.message !== 'TOKEN_EXPIRED') {
        console.error('Custom report export error:', err);
        showStatus('Raportin vienti ep\u00e4onnistui. Tarkista verkkoyhteytesi.', true);
      }
    }
  };

  // ── Ampuma.com PDF import ─────────────────────────────────────────────────

  document.getElementById('import-pdf').onclick = () => {
    document.getElementById('import-pdf-input').click();
  };

  document.getElementById('import-pdf-input').onchange = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;

    showLoader();
    try {
      if (!window.pdfjsLib) {
        await loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js');
        window.pdfjsLib.GlobalWorkerOptions.workerSrc =
          'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      }

      const text = await extractAmpumaPDFText(file);
      // Log extracted text so we can debug if the parser fails
      console.log('[Ampuma import] raw extracted text:\n' + text.slice(0, 4000));

      const rows = parseAmpumaPDFText(text);

      if (rows.length === 0) {
        showStatus(
          'PDF:st\u00e4 ei l\u00f6ytynyt merkint\u00f6j\u00e4. ' +
          'Avaa selaimen kehitysty\u00f6kalut (F12 \u2192 Console) n\u00e4hd\u00e4ksesi mit\u00e4 PDF:st\u00e4 saatiin.',
          true
        );
        return;
      }

      const totalRounds = rows.reduce((s, r) => s + (parseInt(r[7]) || 0), 0);
      const s = rows[0];
      document.getElementById('import-preview').innerHTML =
        '<p>L\u00f6ydettiin <strong>' + rows.length + ' suoritusta</strong> yhteens\u00e4 <strong>' + totalRounds + ' laukauksella</strong>.</p>' +
        '<p style="font-size:0.85rem;opacity:0.75">Esimerkki: ' + escapeHTML(s[0]) + ' \u2013 ' + escapeHTML(s[1]) + ', ' + escapeHTML(s[2]) + ', ' + escapeHTML(s[6]) + '</p>' +
        '<p style="font-size:0.85rem;opacity:0.75">Huom: allekirjoituskuvat eiv\u00e4t siirry; ammunnanjohtajan nimi tallennetaan kuvaus-kentt\u00e4\u00e4n.</p>';

      window._pendingImportRows = rows;
      document.getElementById('import-modal').style.display = 'flex';
    } catch (err) {
      console.error('PDF import error:', err);
      showStatus('PDF:n lukeminen ep\u00e4onnistui: ' + err.message, true);
    } finally {
      hideLoader();
    }
  };

  document.getElementById('import-cancel').onclick = () => {
    document.getElementById('import-modal').style.display = 'none';
    window._pendingImportRows = null;
  };

  document.getElementById('import-ok').onclick = async () => {
    const rows = window._pendingImportRows;
    if (!rows) return;
    document.getElementById('import-modal').style.display = 'none';
    window._pendingImportRows = null;

    showLoader();
    try {
      const sheetId = await getSheetIdByTitle(SHEET_TAB);
      if (!sheetId) throw new Error('Sheet tab not found');

      const countData = await apiFetch(
        'https://sheets.googleapis.com/v4/spreadsheets/' + spreadsheetId + '/values/' + SHEET_TAB + '!A:A'
      );
      const startRow = countData.values?.length ?? 1;

      const CHUNK = 50;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const chunk = rows.slice(i, i + CHUNK);
        await apiFetch(
          'https://sheets.googleapis.com/v4/spreadsheets/' + spreadsheetId + ':batchUpdate',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              requests: [{
                updateCells: {
                  start: { sheetId, rowIndex: startRow + i, columnIndex: 0 },
                  rows: chunk.map(r => ({
                    values: r.map(val => ({ userEnteredValue: { stringValue: String(val) } }))
                  })),
                  fields: 'userEnteredValue'
                }
              }]
            })
          }
        );
      }

      showStatus('Tuotu ' + rows.length + ' merkint\u00e4\u00e4 onnistuneesti!');
      loadEntries();
    } catch (err) {
      if (err.message !== 'TOKEN_EXPIRED') {
        console.error('Import write error:', err);
        showStatus('Merkint\u00f6jen kirjoitus ep\u00e4onnistui.', true);
      }
    } finally {
      hideLoader();
    }
  };

  // Extract text from PDF using pdf.js, grouping items by y-coordinate with a
  // tolerance to handle slight baseline variations within a visual line.
  async function extractAmpumaPDFText(file) {
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    const allLines = [];

    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();

      // Group items whose y-coordinates are within 4px of each other
      const groups = [];
      for (const item of content.items) {
        const str = item.str;
        if (!str || !str.trim()) continue;
        const y = item.transform[5];
        const x = item.transform[4];
        let placed = false;
        for (const g of groups) {
          if (Math.abs(y - g.y) <= 4) {
            g.items.push({ x, str });
            placed = true;
            break;
          }
        }
        if (!placed) groups.push({ y, items: [{ x, str }] });
      }

      // PDF y=0 is bottom, so sort descending = top-to-bottom reading order
      groups.sort((a, b) => b.y - a.y);
      for (const g of groups) {
        g.items.sort((a, b) => a.x - b.x);
        const line = g.items.map(i => i.str).join(' ').trim();
        if (line) allLines.push(line);
      }
    }

    return allLines.join('\n');
  }

  // Parse text extracted from an Ampuma.com diary PDF into rows suitable for
  // the Google Sheet.  The PDF renders each performance as a single visual line
  // with all fields (discipline, weapon type, TT, model, caliber, rounds)
  // spread across columns at the same y-coordinate.
  function parseAmpumaPDFText(rawText) {
    // Ensure "Ammunnanjohtajan allekirjoitus" is always on its own line
    // regardless of where pdf.js placed it relative to surrounding items.
    const text = rawText
      .replace(/Ammunnanjohtajan allekirjoitus/gi, '\nAmmunnanjohtajan allekirjoitus\n')
      .replace(/\n{2,}/g, '\n');

    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    const rows  = [];

    // "N. DD.MM.YYYY - [Suomi, ]City, Location"
    const ENTRY_HDR = /^(\d+)\.\s+(\d{2}\.\d{2}\.\d{4})\s+-\s+(?:Suomi,\s*)?(.+)$/;

    // Full performance line — all fields on one line:
    // "N. Discipline (SessionType) WeaponType - TTN [(running)] Model, Caliber N laukausta"
    // When the TT running total reaches 10+ digits it wraps to the next line in the PDF,
    // so the (?:\s*\(\d+\))? group is optional.
    const PERF_LINE = /^(\d+)\.\s+(.+?)\s+\((.+?)\)\s+(Pistooli|Kiv\u00e4\u00e4ri|Haulikko|Pienoiskiv\u00e4\u00e4ri|Muu)\s+-\s+(TT\d)(?:\s*\(\d+\))?\s+(.+?),\s*([^\s,]+)\s+(\d+)\s+laukausta/i;

    // Lines to skip (page headers, user-info box, verification text, metadata)
    const SKIP = /^(Tulostettu|Tulostemallin versio|Ampuma\s+[-\u2013]\s+s\u00e4hk\u00f6inen|K\u00e4ytt\u00e4j\u00e4tietojen versio|Merkinn\u00e4n tiiviste|P\u00e4iv\u00e4kirjamerkint\u00e4 lis\u00e4tty|Ampuma\.com|K\u00e4ytt\u00e4j\u00e4n tiedot|K\u00e4ytt\u00e4j\u00e4n unikki|Voit |Etunimi|Sukunimi|Tulosteen tunniste|Ampuman k\u00e4ytt\u00f6|T\u00e4m\u00e4 ampuma|Ne sis\u00e4lt\u00e4v\u00e4t|P\u00e4iv\u00e4kirjamerkinn\u00e4t on|Suorituksissa|Suorituksen laukausten|Ampuman avulla|Suoritukset jakautuivat|K\u00e4ytt\u00e4j\u00e4tunnus|K\u00e4ytt\u00e4j\u00e4tietojen nykyinen|allekirjoitettu digitaalisesti|\d+\s*\(\d+\))/i;

    let date = null, location = null;
    let currentRow = null;
    let expectInstructor = false;

    function flush() {
      if (currentRow) { rows.push(currentRow); currentRow = null; }
      expectInstructor = false;
    }

    for (const line of lines) {
      // Boilerplate: skip and reset instructor-name wait
      if (SKIP.test(line)) { expectInstructor = false; continue; }

      // Instructor name sits on its own line after the label + signature image
      if (expectInstructor) {
        if (currentRow && !line.includes(':')) currentRow[8] = 'Ammunnanjohtaja: ' + line.trim();
        expectInstructor = false;
        continue;
      }

      if (/^Ammunnanjohtajan allekirjoitus$/i.test(line)) {
        expectInstructor = true;
        continue;
      }

      // Diary entry header
      const em = line.match(ENTRY_HDR);
      if (em) {
        flush();
        const [day, month, year] = em[2].split('.');
        date     = year + '-' + month + '-' + day;
        location = em[3].trim();
        continue;
      }

      // Performance line (all data on one visual line)
      const pm = line.match(PERF_LINE);
      if (pm) {
        flush();
        const [, , disc, sessType, weaponType, tt, model, caliber, roundsStr] = pm;
        currentRow = [
          date        || '',
          disc.trim() + ' (' + sessType.trim() + ')',
          weaponType,
          caliber.trim(),
          model.trim(),
          tt,
          location    || '',
          roundsStr,
          '',   // notes/instructor (filled when "Ammunnanjohtajan allekirjoitus" is found)
          ''    // signature
        ];
        continue;
      }
    }

    flush();
    return rows;
  }

  let lastScrollY = window.scrollY;
  const header = document.querySelector('.site-header');
  const nav = document.querySelector('.nav-links');

  window.addEventListener('scroll', () => {
    const currentScrollY = window.scrollY;

    if (nav.classList.contains('open')) {
      nav.classList.remove('open');
    }

    if (currentScrollY > lastScrollY && currentScrollY > 100) {
      header.classList.remove('nav-shown');
      header.classList.add('nav-hidden');
    } else {
      header.classList.remove('nav-hidden');
      header.classList.add('nav-shown');
    }

    lastScrollY = currentScrollY;
  });

  document.addEventListener('DOMContentLoaded', () => {
    document.querySelector('.site-header').classList.add('nav-shown');
  });
