# DataLens

CSV analyzer with a stunning dark-mode "liquid glass" UI and powerful bivariate analysis features. 

DataLens is designed to easily ingest, understand, and visualize datasets without requiring Python code.

## Local Dev

```bash
python3 -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

Then open **http://localhost:8080** in your browser.

## Features

- **Robust Uploads** — Upload CSVs up to 100 MB securely straight to disk (preventing server memory crashes).
- **Type Inference** — Automatically detects columns as numeric, string, categorical, or date.
- **Distributions** — Histograms for numeric data and bar charts for categorical data rendered beautifully via Chart.js.
- **Deep Univariate Analysis** — Instant descriptive stats (mean, median, standard deviation), IQR-based outlier detection, missing percentage, and Shapiro-Wilk normality tests.
- **Bivariate Analysis (Compare)** — Select two columns to see relationship trends:
  - Numeric vs Numeric: Scatter plots with continuous Linear Regression & R-values.
  - Categorical vs Numeric: Mean aggregated bar charts.
  - Categorical vs Categorical: Stacked bar cross-tabulations.
- **Dark UI** — Responsive sidebar layout, purple/yellow accents, `JetBrains Mono` fonts.

## Architecture & Performance

```
datalens/
├── app.py              # Flask backend — Routing, Stats, File Cleanup, Security
├── requirements.txt    # pandas, numpy, scipy, gunicorn, etc.
├── temp_uploads/       # Ephemeral CSV cache supporting /compare requests
├── static/
│   ├── css/style.css   # Dark-theme variables and pure CSS styling
│   └── js/main.js      # Decoupled Chart.js rendering, DocumentFragments, fetch handling
└── templates/
    └── index.html      # Clean structural markup
```

- **Separated Assets:** CSS, JS, and HTML are fully separated for optimal caching, code readability, and strict separation of concerns.
- **Memory Optimized:** Files are saved directly to disk avoiding "double I/O" decoding that crashes small servers.
- **Storage Lifecycle:** Old cache files in `temp_uploads` are asynchronously purged during new file uploads.
- **Bulletproof XSS Security:** Uses pure `document.createElement` / `textContent` rendering. No raw `innerHTML` on client data.
- **Secure File Access:** The `/compare` endpoint rigorously enforces UUID parsing on paths, closing off Path Traversal vectors.

## Libraries

| Operation | Implementation |
|---|---|
| Frontend Charts | Chart.js 4.4 |
| CSV parsing & inference | pandas |
| Descriptive stats & IQR | pandas / numpy |
| Bivariate Regression | scipy.stats.linregress |
| Normality tracking | scipy.stats.shapiro |
| Type safety & caching | uuid / os |
