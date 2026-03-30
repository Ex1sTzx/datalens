// ── state ──────────────────────────────────────────────────────────────────────
    let globalData = null;
    let currentChart = null;
    let currentFileId = null;
    let compareChartInstance = null;

    // ── Chart.js defaults ──────────────────────────────────────────────────────────
    Chart.defaults.color = '#a1a1aa';
    Chart.defaults.font.family = "'JetBrains Mono', monospace";
    Chart.defaults.borderColor = '#27272a';

    // ── DOM refs ───────────────────────────────────────────────────────────────────
    const uploadZone = document.getElementById('upload-section');
    const fileInput = document.getElementById('file-input');
    const loader = document.getElementById('loading-overlay');
    const dashboard = document.getElementById('dashboard-section');
    const errorToast = document.getElementById('error-toast');

    // ── drag & drop ────────────────────────────────────────────────────────────────
    uploadZone.addEventListener('click', (e) => {
      if (e.target.tagName !== 'INPUT') fileInput.click();
    });
    uploadZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      uploadZone.classList.add('dragover');
    });
    uploadZone.addEventListener('dragleave', () => {
      uploadZone.classList.remove('dragover');
    });
    uploadZone.addEventListener('drop', (e) => {
      e.preventDefault();
      uploadZone.classList.remove('dragover');
      if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
    });
    fileInput.addEventListener('change', (e) => {
      if (e.target.files.length) handleFile(e.target.files[0]);
    });

    // ── showError ──────────────────────────────────────────────────────────────────
    function showError(msg) {
      errorToast.textContent = '⚠ ' + msg;
      errorToast.classList.remove('hidden');
      setTimeout(() => errorToast.classList.add('hidden'), 5000);
    }

    // ── file upload ────────────────────────────────────────────────────────────────
    async function handleFile(file) {
      if (!file.name.endsWith('.csv')) {
        showError('Please upload a CSV file.');
        return;
      }

      loader.classList.remove('hidden');
      const formData = new FormData();
      formData.append('file', file);

      try {
        const response = await fetch('/analyze', { method: 'POST', body: formData });
        let data;
        try {
          data = await response.json();
        } catch (e) {
          throw new Error('Server returned an invalid response (not JSON).');
        }
        if (!response.ok) {
          showError(data.error || 'Analysis failed.');
          return;
        }
        globalData = data;
        currentFileId = data.file_id;
        renderDashboard(data);
      } catch (error) {
        showError('Upload failed: ' + error.message);
      } finally {
        loader.classList.add('hidden');
      }
    }

    // ── render dashboard ───────────────────────────────────────────────────────────
    function renderDashboard(data) {
      uploadZone.classList.add('hidden');
      dashboard.classList.remove('hidden');
      document.getElementById('new-analysis-btn').classList.remove('hidden');

      // 1. KPIs
      document.querySelector('#kpi-rows .value').innerText = data.overview.rows.toLocaleString();
      document.querySelector('#kpi-cols .value').innerText = data.overview.cols.toLocaleString();
      document.querySelector('#kpi-missing .value').innerText = data.overview.total_missing.toLocaleString();
      document.querySelector('#kpi-dupes .value').innerText = data.overview.duplicates.toLocaleString();

      // 2. Schema list
      const schemaList = document.getElementById('schema-list');
      schemaList.innerHTML = '';
      const select = document.getElementById('chart-col-select');
      select.innerHTML = '';

      const schemaFragment = document.createDocumentFragment();
      const selectFragment = document.createDocumentFragment();

      data.columns.forEach((col, idx) => {
        // Schema item (safe textContent mapping instead of innerHTML)
        const div = document.createElement('div');
        div.className = 'schema-item';
        div.dataset.idx = idx;
        const typeClass = col.type === 'numeric' ? 'type-numeric'
          : col.type === 'date' ? 'type-date'
            : col.type === 'empty' ? 'type-empty'
              : 'type-categorical';
        
        const topDiv = document.createElement('div');
        const indicator = document.createElement('span');
        indicator.className = `type-indicator ${typeClass}`;
        topDiv.appendChild(indicator);
        topDiv.appendChild(document.createTextNode(col.name));

        const botDiv = document.createElement('div');
        botDiv.className = 'text-muted';
        botDiv.textContent = `${col.type} · ${col.missing_perc.toFixed(1)}% null`;

        div.appendChild(topDiv);
        div.appendChild(botDiv);

        div.onclick = () => {
          document.querySelectorAll('.schema-item').forEach(el => el.classList.remove('active'));
          div.classList.add('active');
          renderColumnDetails(col);
        };
        schemaFragment.appendChild(div);

        // Select dropdown option
        const opt = document.createElement('option');
        opt.value = idx;
        opt.textContent = col.name;
        selectFragment.appendChild(opt);
      });

      schemaList.appendChild(schemaFragment);
      select.appendChild(selectFragment);

      select.onchange = (e) => renderChart(data.columns[e.target.value]);

      // 3. Populate comparison dropdowns
      const cmp1 = document.getElementById('compare-col-1');
      const cmp2 = document.getElementById('compare-col-2');
      cmp1.innerHTML = '';
      cmp2.innerHTML = '';
      const cmp1Fragment = document.createDocumentFragment();
      const cmp2Fragment = document.createDocumentFragment();

      data.columns.forEach((col, idx) => {
        const o1 = document.createElement('option');
        o1.value = col.name; o1.textContent = col.name;
        cmp1Fragment.appendChild(o1);
        const o2 = document.createElement('option');
        o2.value = col.name; o2.textContent = col.name;
        cmp2Fragment.appendChild(o2);
      });
      
      cmp1.appendChild(cmp1Fragment);
      cmp2.appendChild(cmp2Fragment);
      
      if (data.columns.length > 1) cmp2.selectedIndex = 1;

      // 4. Data Preview Table
      const headTr = document.getElementById('data-preview-head');
      const bodyTb = document.getElementById('data-preview-body');
      headTr.innerHTML = '';
      bodyTb.innerHTML = '';
      
      if (data.sample_data && data.sample_data.length > 0) {
        // Headers
        data.columns.forEach(col => {
          const th = document.createElement('th');
          th.textContent = col.name;
          headTr.appendChild(th);
        });

        // Rows
        const tbodyFrag = document.createDocumentFragment();
        data.sample_data.forEach(row => {
          const tr = document.createElement('tr');
          data.columns.forEach(col => {
            const td = document.createElement('td');
            td.textContent = row[col.name];
            tr.appendChild(td);
          });
          tbodyFrag.appendChild(tr);
        });
        bodyTb.appendChild(tbodyFrag);
      }

      // Initial render
      if (data.columns.length > 0) {
        renderChart(data.columns[0]);
        renderColumnDetails(data.columns[0]);
      }
    }

    // ── reset dashboard ────────────────────────────────────────────────────────────
    function resetDashboard() {
      if (currentChart) { currentChart.destroy(); currentChart = null; }
      if (compareChartInstance) { compareChartInstance.destroy(); compareChartInstance = null; }
      globalData = null;
      currentFileId = null;
      document.getElementById('data-preview-head').innerHTML = '';
      document.getElementById('data-preview-body').innerHTML = '';
      dashboard.classList.add('hidden');
      document.getElementById('new-analysis-btn').classList.add('hidden');
      uploadZone.classList.remove('hidden');
      fileInput.value = '';
    }

    // ── column details ─────────────────────────────────────────────────────────────
    function renderColumnDetails(col) {
      const content = document.getElementById('column-details-content');
      content.innerHTML = ''; // Start clean
      const frag = document.createDocumentFragment();

      function addRow(labelStr, valStr) {
        const row = document.createElement('div');
        row.className = 'detail-row';
        const labelEl = document.createElement('span');
        labelEl.className = 'text-muted';
        labelEl.textContent = labelStr;
        const valEl = document.createElement('span');
        valEl.textContent = valStr;
        row.appendChild(labelEl);
        row.appendChild(valEl);
        frag.appendChild(row);
      }

      // Always show basic info
      addRow('Type', col.type);
      addRow('Unique', col.unique_count != null ? col.unique_count.toLocaleString() : '—');
      addRow('Missing', `${col.missing_count} (${col.missing_perc.toFixed(1)}%)`);

      if (col.stats) {
        for (const [key, val] of Object.entries(col.stats)) {
          if (val === null || val === undefined) continue;
          let displayVal;
          if (typeof val === 'boolean') {
            displayVal = val ? 'Yes' : 'No';
          } else if (typeof val === 'number') {
            displayVal = val % 1 !== 0 ? val.toFixed(4) : val.toLocaleString();
          } else {
            displayVal = val;
          }
          const label = key.replace(/_/g, ' ');
          addRow(label, displayVal);
        }
      } else {
        const p = document.createElement('p');
        p.className = 'text-muted';
        p.style.marginTop = '12px';
        p.textContent = `No numeric stats for type: ${col.type}`;
        frag.appendChild(p);
      }

      content.appendChild(frag);
    }

    // ── theme variables helper ─────────────────────────────────────────────────────
    function getCssVar(name) {
      return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    }

    // ── chart rendering ────────────────────────────────────────────────────────────
    function renderChart(col) {
      if (!col.distribution || col.distribution.length === 0) return;

      const labels = col.distribution.map(d => d.label);
      const counts = col.distribution.map(d => d.count);
      const ctx = document.getElementById('mainChart').getContext('2d');

      if (currentChart) currentChart.destroy();

      const accentPurple = getCssVar('--accent-purple');
      const bgColor = getCssVar('--bg-panel');
      const borderColor = getCssVar('--border');
      const textColor = getCssVar('--text-muted');

      // Purple gradient for area fill
      const gradient = ctx.createLinearGradient(0, 0, 0, 400);
      gradient.addColorStop(0, accentPurple.replace(')', ', 0.4)').replace('rgb', 'rgba')); // fallback if Hex is used vs rgb
      gradient.addColorStop(1, accentPurple.replace(')', ', 0.0)').replace('rgb', 'rgba'));

      // If it's a hex code, simple conversion works:
      function hexToRgba(hex, alpha) {
          const r = parseInt(hex.slice(1, 3), 16);
          const g = parseInt(hex.slice(3, 5), 16);
          const b = parseInt(hex.slice(5, 7), 16);
          return `rgba(${r}, ${g}, ${b}, ${alpha})`;
      }

      const isNumeric = col.type === 'numeric';

      currentChart = new Chart(ctx, {
        type: isNumeric ? 'line' : 'bar',
        data: {
          labels: labels,
          datasets: [{
            label: 'Count',
            data: counts,
            borderColor: accentPurple,
            backgroundColor: isNumeric ? gradient : hexToRgba(accentPurple, 0.55),
            borderWidth: 2,
            fill: true,
            tension: 0.4,
            pointRadius: 0,
            pointHoverRadius: 6,
            pointHoverBackgroundColor: accentPurple,
            borderRadius: isNumeric ? 0 : 4,
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: { duration: 700, easing: 'easeOutQuart' },
          interaction: { mode: 'index', intersect: false },
          scales: {
            y: {
              beginAtZero: true,
              grid: { color: borderColor, drawBorder: false },
              ticks: { color: textColor, font: { family: "'JetBrains Mono', monospace", size: 10 } },
              border: { color: borderColor }
            },
            x: {
              grid: { display: false, drawBorder: false },
              ticks: {
                color: textColor,
                font: { family: "'JetBrains Mono', monospace", size: 10 },
                maxRotation: 45, minRotation: 0,
                maxTicksLimit: 15,
              },
              border: { color: borderColor }
            }
          },
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: hexToRgba(bgColor, 0.92),
              titleColor: accentPurple,
              bodyColor: '#fafafa',
              borderColor: borderColor,
              borderWidth: 1,
              padding: 12,
              cornerRadius: 10,
              titleFont: { family: "'JetBrains Mono', monospace", size: 11 },
              bodyFont: { family: "'JetBrains Mono', monospace", size: 11 },
            }
          }
        }
      });
    }

    // ── comparison logic ───────────────────────────────────────────────────────────
    document.getElementById('run-compare-btn').addEventListener('click', async () => {
      const col1 = document.getElementById('compare-col-1').value;
      const col2 = document.getElementById('compare-col-2').value;
      if (col1 === col2) { showError('Please select two different columns.'); return; }
      if (!currentFileId) { showError('No dataset loaded.'); return; }

      try {
        const res = await fetch('/compare', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ file_id: currentFileId, col1, col2 }),
        });
        let data;
        try {
          data = await res.json();
        } catch (e) {
          throw new Error('Server returned an invalid response (not JSON).');
        }
        if (!res.ok) { showError(data.error || 'Comparison failed.'); return; }

        if (compareChartInstance) { compareChartInstance.destroy(); compareChartInstance = null; }
        const statsDiv = document.getElementById('compare-stats');
        const ctx = document.getElementById('compareChart').getContext('2d');

        const darkGrid = { color: '#27272a', drawBorder: false };
        const darkTicks = { color: '#a1a1aa', font: { family: "'JetBrains Mono', monospace", size: 10 } };
        const darkBorder = { color: '#27272a' };
        const textColor = getCssVar('--text-muted');
        const ttip = {
          backgroundColor: 'rgba(20, 20, 23, 0.92)', titleColor: '#8b5cf6',
          bodyColor: '#fafafa', borderColor: '#27272a', borderWidth: 1,
          padding: 12, cornerRadius: 10,
          titleFont: { family: "'JetBrains Mono', monospace", size: 11 },
          bodyFont: { family: "'JetBrains Mono', monospace", size: 11 },
        };

        if (data.type === 'scatter') {
          compareChartInstance = new Chart(ctx, {
            type: 'scatter',
            data: {
              datasets: [{
                label: `${col1} vs ${col2}`,
                data: data.points,
                pointBackgroundColor: '#8b5cf6',
                pointBorderColor: 'rgba(139,92,246,0.6)',
                pointRadius: 4,
                pointHoverRadius: 6,
              }]
            },
            options: {
              responsive: true, maintainAspectRatio: false,
              animation: { duration: 700, easing: 'easeOutQuart' },
              scales: {
                x: { grid: darkGrid, ticks: darkTicks, border: darkBorder, title: { display: true, text: col1, color: textColor } },
                y: { grid: darkGrid, ticks: darkTicks, border: darkBorder, title: { display: true, text: col2, color: textColor } },
              },
              plugins: { legend: { display: false }, tooltip: ttip },
            },
          });
          
          statsDiv.innerHTML = '';
          const frag = document.createDocumentFragment();
          if (data.trendline) {
            const t = data.trendline;
            function addRow(lbl, val) {
              const row = document.createElement('div');
              row.className = 'detail-row';
              const lSpan = document.createElement('span');
              lSpan.className = 'text-muted';
              lSpan.textContent = lbl;
              const vSpan = document.createElement('span');
              vSpan.textContent = val;
              row.appendChild(lSpan);
              row.appendChild(vSpan);
              frag.appendChild(row);
            }
            addRow('R-value', t.r);
            addRow('Slope', t.slope);
            addRow('Intercept', t.intercept);
            addRow('P-value', t.p);
            
            const p = document.createElement('p');
            p.className = 'text-muted';
            p.style.marginTop = '8px';
            p.style.fontSize = '12px';
            p.textContent = `Linear regression: y = ${t.slope}x + ${t.intercept}`;
            frag.appendChild(p);
          } else {
            const p = document.createElement('p');
            p.className = 'text-muted';
            p.textContent = 'Not enough data for trendline.';
            frag.appendChild(p);
          }
          statsDiv.appendChild(frag);
          
        } else if (data.type === 'bar') {
          const accentYellow = getCssVar('--accent-yellow');
          const gradient = ctx.createLinearGradient(0, 0, 0, 350);
          gradient.addColorStop(0, accentYellow.replace(')', ', 0.6)').replace('rgb', 'rgba'));
          gradient.addColorStop(1, accentYellow.replace(')', ', 0.1)').replace('rgb', 'rgba'));
          compareChartInstance = new Chart(ctx, {
            type: 'bar',
            data: {
              labels: data.labels,
              datasets: [{
                label: `Mean of ${col1 === data.labels[0] ? col2 : col1}`,
                data: data.values,
                backgroundColor: accentYellow,
                borderRadius: 4,
              }]
            },
            options: {
              responsive: true, maintainAspectRatio: false,
              animation: { duration: 700, easing: 'easeOutQuart' },
              scales: {
                x: { grid: { display: false, drawBorder: false }, ticks: darkTicks, border: darkBorder },
                y: { beginAtZero: true, grid: darkGrid, ticks: darkTicks, border: darkBorder },
              },
              plugins: { legend: { display: false }, tooltip: ttip },
            },
          });
          
          statsDiv.innerHTML = '';
          const p = document.createElement('p');
          p.className = 'text-muted';
          p.textContent = 'Mean values of the numeric column grouped by the top 10 categories.';
          statsDiv.appendChild(p);
          
        } else if (data.type === 'stacked_bar') {
          const colors = [
              getCssVar('--accent-purple'), 
              getCssVar('--accent-yellow'), 
              '#22c55e', '#f43f5e', '#22d3ee'
          ];
          compareChartInstance = new Chart(ctx, {
            type: 'bar',
            data: {
              labels: data.x_labels,
              datasets: data.datasets.map((ds, i) => ({
                label: ds.label,
                data: ds.data,
                backgroundColor: colors[i % colors.length],
                borderRadius: 2,
              })),
            },
            options: {
              responsive: true, maintainAspectRatio: false,
              animation: { duration: 700, easing: 'easeOutQuart' },
              scales: {
                x: { stacked: true, grid: { display: false, drawBorder: false }, ticks: darkTicks, border: darkBorder },
                y: { stacked: true, beginAtZero: true, grid: darkGrid, ticks: darkTicks, border: darkBorder },
              },
              plugins: {
                legend: { labels: { color: textColor, font: { family: "'JetBrains Mono', monospace", size: 11 } } },
                tooltip: ttip,
              },
            },
          });
          
          statsDiv.innerHTML = '';
          const p = document.createElement('p');
          p.className = 'text-muted';
          p.textContent = 'Crosstab of top 5 categories from each column.';
          statsDiv.appendChild(p);

        } else if (data.type === 'line') {
          const accentPurple = getCssVar('--accent-purple');
          compareChartInstance = new Chart(ctx, {
            type: 'line',
            data: {
              labels: data.labels,
              datasets: [{
                label: 'Daily Mean',
                data: data.values,
                borderColor: accentPurple,
                backgroundColor: 'rgba(139, 92, 246, 0.1)',
                borderWidth: 2, fill: true, tension: 0.3, pointRadius: 0, pointHoverRadius: 5,
              }]
            },
            options: {
              responsive: true, maintainAspectRatio: false,
              animation: { duration: 700, easing: 'easeOutQuart' },
              interaction: { mode: 'index', intersect: false },
              scales: {
                x: { grid: { display: false, drawBorder: false }, ticks: darkTicks, border: darkBorder, 
                     title: { display: true, text: 'Time', color: textColor } },
                y: { grid: darkGrid, ticks: darkTicks, border: darkBorder },
              },
              plugins: { legend: { display: false }, tooltip: ttip },
            },
          });
          
          statsDiv.innerHTML = '';
          const p = document.createElement('p');
          p.className = 'text-muted';
          p.textContent = 'Time-series trend aggregating the numeric values over dates.';
          statsDiv.appendChild(p);
        }
      } catch (err) {
        showError('Comparison failed: ' + err.message);
      }
    });