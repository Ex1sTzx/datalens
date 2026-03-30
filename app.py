import os
import io
import json
import uuid
import warnings

import numpy as np
import pandas as pd
import scipy.stats
from flask import Flask, jsonify, render_template, request
from werkzeug.utils import secure_filename

warnings.filterwarnings("ignore")

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 100 * 1024 * 1024  # 100 MB

UPLOAD_FOLDER = "temp_uploads"
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

import time

def cleanup_old_files(max_age_seconds=3600):
    """Remove files in UPLOAD_FOLDER older than max_age_seconds to prevent storage leaks."""
    now = time.time()
    for fname in os.listdir(UPLOAD_FOLDER):
        fpath = os.path.join(UPLOAD_FOLDER, fname)
        if os.path.isfile(fpath) and fname.endswith('.csv'):
            if os.stat(fpath).st_mtime < now - max_age_seconds:
                try:
                    os.remove(fpath)
                except OSError:
                    pass


# ── helpers ────────────────────────────────────────────────────────────────────


def clean_numpy(val):
    """Convert numpy/pandas scalars to JSON-safe Python types."""
    if val is None:
        return None
    try:
        if pd.isna(val):
            return None
    except (TypeError, ValueError):
        pass
    if isinstance(val, (np.integer,)):
        return int(val)
    if isinstance(val, (np.floating,)):
        if np.isinf(val):
            return None
        return float(val)
    if isinstance(val, (np.bool_,)):
        return bool(val)
    return val


def infer_col_type(series: pd.Series) -> str:
    """Return one of: numeric, date, categorical, string, empty."""
    if series.isna().all():
        return "empty"
    if pd.api.types.is_bool_dtype(series):
        return "categorical"
    if pd.api.types.is_numeric_dtype(series):
        return "numeric"
    # try datetime
    try:
        pd.to_datetime(series.dropna().head(100))
        return "date"
    except Exception:
        pass
    if series.nunique() < 15 and len(series) > 0:
        return "categorical"
    return "string"


def get_numeric_stats(series: pd.Series) -> dict:
    """Compute descriptive statistics for a numeric column."""
    clean = series.dropna()
    if len(clean) == 0:
        return {}

    q1 = clean.quantile(0.25)
    q3 = clean.quantile(0.75)
    iqr = q3 - q1
    outlier_mask = (clean < (q1 - 1.5 * iqr)) | (clean > (q3 + 1.5 * iqr))

    # Shapiro-Wilk on a sample (max 5000)
    sample = clean.sample(min(len(clean), 5000), random_state=42)
    try:
        _, normality_p = scipy.stats.shapiro(sample)
        is_normal = bool(normality_p > 0.05)
    except Exception:
        is_normal = None
        normality_p = None

    return {
        "mean": clean_numpy(clean.mean()),
        "median": clean_numpy(clean.median()),
        "std": clean_numpy(clean.std()),
        "min": clean_numpy(clean.min()),
        "max": clean_numpy(clean.max()),
        "q1": clean_numpy(q1),
        "q3": clean_numpy(q3),
        "iqr": clean_numpy(iqr),
        "skewness": clean_numpy(clean.skew()),
        "outlier_count": int(outlier_mask.sum()),
        "is_normal": is_normal,
        "normality_p": clean_numpy(normality_p),
    }


def get_distribution(series: pd.Series, col_type: str) -> list:
    """Return distribution data as a list of {label, count} dicts."""
    if col_type == "numeric":
        clean = series.dropna()
        if len(clean) == 0:
            return []
        counts, edges = np.histogram(clean, bins=15)
        return [
            {
                "label": f"{clean_numpy(edges[i]):.1f}–{clean_numpy(edges[i+1]):.1f}",
                "count": int(counts[i]),
            }
            for i in range(len(counts))
        ]
    else:
        vc = series.value_counts().head(10)
        return [{"label": str(k), "count": int(v)} for k, v in vc.items()]


def get_correlations(df: pd.DataFrame) -> list:
    """Return upper-triangle Pearson correlations for numeric columns."""
    numeric_cols = df.select_dtypes(include="number").columns.tolist()[:15]
    if len(numeric_cols) < 2:
        return []
    corr = df[numeric_cols].corr(method="pearson")
    pairs = []
    for i, c1 in enumerate(numeric_cols):
        for j, c2 in enumerate(numeric_cols):
            if i < j:
                r = corr.loc[c1, c2]
                if pd.notna(r):
                    pairs.append(
                        {"col1": c1, "col2": c2, "r": round(float(r), 4)}
                    )
    pairs.sort(key=lambda x: abs(x["r"]), reverse=True)
    return pairs


def get_numeric_trendline(df: pd.DataFrame, col_x: str, col_y: str) -> dict:
    """Scatter plot data with linear trendline for two numeric columns."""
    sub = df[[col_x, col_y]].dropna()
    if len(sub) < 2:
        return {"type": "scatter", "trendline": None, "points": []}
    slope, intercept, r_value, p_value, _ = scipy.stats.linregress(sub[col_x], sub[col_y])
    sample = sub.sample(min(len(sub), 500), random_state=42)
    points = [{"x": clean_numpy(row[col_x]), "y": clean_numpy(row[col_y])} for _, row in sample.iterrows()]
    return {
        "type": "scatter",
        "trendline": {
            "slope": round(float(slope), 4),
            "intercept": round(float(intercept), 4),
            "r": round(float(r_value), 4),
            "p": round(float(p_value), 6),
        },
        "points": points,
    }


def get_categorical_numeric_agg(df: pd.DataFrame, cat_col: str, num_col: str) -> dict:
    """Mean of a numeric column grouped by top categories."""
    sub = df[[cat_col, num_col]].dropna()
    top_cats = sub[cat_col].value_counts().head(10).index.tolist()
    filtered = sub[sub[cat_col].isin(top_cats)]
    grouped = filtered.groupby(cat_col)[num_col].mean()
    # Sort by the original frequency order
    grouped = grouped.reindex(top_cats)
    return {
        "type": "bar",
        "labels": [str(l) for l in grouped.index.tolist()],
        "values": [clean_numpy(v) for v in grouped.values.tolist()],
    }


def get_crosstab(df: pd.DataFrame, col1: str, col2: str) -> dict:
    """Crosstab (stacked bar) for two categorical columns."""
    top1 = df[col1].value_counts().head(5).index.tolist()
    top2 = df[col2].value_counts().head(5).index.tolist()
    filtered = df[df[col1].isin(top1) & df[col2].isin(top2)]
    ct = pd.crosstab(filtered[col1], filtered[col2])
    datasets = []
    for c in ct.columns:
        datasets.append({"label": str(c), "data": [int(v) for v in ct[c].values.tolist()]})
    return {
        "type": "stacked_bar",
        "x_labels": [str(l) for l in ct.index.tolist()],
        "datasets": datasets,
    }


def get_time_series_agg(df: pd.DataFrame, date_col: str, num_col: str) -> dict:
    """Time series line chart aggregating a numeric column by date (Daily Mean)."""
    sub = df[[date_col, num_col]].dropna()
    sub['__date'] = pd.to_datetime(sub[date_col], errors='coerce')
    sub = sub.dropna(subset=['__date'])
    sub['__date'] = sub['__date'].dt.date
    
    grouped = sub.groupby('__date')[num_col].mean().sort_index()
    
    # Cap at 100 points maximum to avoid chart crowding
    if len(grouped) > 100:
        # For simplicity, resample or just take the last 100. We'll take uniform samples if huge.
        grouped = grouped.iloc[np.linspace(0, len(grouped)-1, 100).astype(int)]
        
    return {
        "type": "line",
        "labels": [str(d) for d in grouped.index],
        "values": [clean_numpy(v) for v in grouped.values],
    }


# ── routes ──────────────────────────────────────────────────────────────────────


@app.route("/")
def index():
    return render_template("index.html")

@app.errorhandler(413)
def request_entity_too_large(error):
    return jsonify({"error": "File exceeds the 100MB size limit."}), 413


@app.route("/analyze", methods=["POST"])
def analyze():
    # Attempt cleanup of old sessions
    cleanup_old_files()

    if "file" not in request.files:
        return jsonify({"error": "No file uploaded."}), 400

    file = request.files["file"]
    if not file.filename or not file.filename.endswith(".csv"):
        return jsonify({"error": "Only CSV files are supported."}), 400

    file_id = str(uuid.uuid4())
    file_path = os.path.join(UPLOAD_FOLDER, f"{file_id}.csv")

    try:
        # Save directly to disk to avoid Double I/O memory bloat
        file.save(file_path)
        # Parse from disk into pandas
        df = pd.read_csv(file_path)
    except pd.errors.EmptyDataError:
        if os.path.exists(file_path):
            os.remove(file_path)
        return jsonify({"error": "The CSV file is empty or malformed."}), 400
    except pd.errors.ParserError as e:
        if os.path.exists(file_path):
            os.remove(file_path)
        return jsonify({"error": f"CSV structure is invalid: {e}"}), 400
    except Exception as e:
        if os.path.exists(file_path):
            os.remove(file_path)
        return jsonify({"error": f"Failed to ingest CSV: {str(e)}"}), 500

    if df.empty:
        os.remove(file_path)
        return jsonify({"error": "The CSV file contains no data rows."}), 400

    import traceback

    try:
        # ── column-level analysis ──────────────────────────────────────────────
        columns = []
        for col in df.columns:
            series = df[col]
            col_type = infer_col_type(series)
            missing_count = int(series.isna().sum())
            missing_perc = round(missing_count / len(df) * 100, 1) if len(df) > 0 else 0

            entry = {
                "name": col,
                "type": col_type,
                "missing_count": missing_count,
                "missing_perc": missing_perc,
                "unique_count": int(series.nunique()),
            }

            if col_type == "numeric":
                entry["stats"] = get_numeric_stats(series)
            else:
                entry["stats"] = None

            entry["distribution"] = get_distribution(series, col_type)
            columns.append(entry)

        # ── overview ──────────────────────────────────────────────────────────
        overview = {
            "rows": len(df),
            "cols": len(df.columns),
            "memory_kb": int(df.memory_usage(deep=True).sum() // 1024),
            "duplicates": int(df.duplicated().sum()),
            "total_missing": int(df.isna().sum().sum()),
        }

        # ── correlations ──────────────────────────────────────────────────────
        correlations = get_correlations(df)

        # ── sample rows ──────────────────────────────────────────────────────
        sample_data = df.head(5).fillna("").to_dict(orient="records")

        return jsonify(
            {
                "file_id": file_id,
                "overview": overview,
                "columns": columns,
                "correlations": correlations,
                "sample_data": sample_data,
            }
        )
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": f"Internal Analysis Error: {str(e)}"}), 500


@app.route("/compare", methods=["POST"])
def compare():
    data = request.get_json()
    if not data or "file_id" not in data or "col1" not in data or "col2" not in data:
        return jsonify({"error": "Missing file_id, col1, or col2."}), 400

    # Prevent Path Traversal by enforcing UUID format
    try:
        parsed_uuid = uuid.UUID(data["file_id"])
        if str(parsed_uuid) != data["file_id"]:
            raise ValueError("Invalid UUID string")
    except ValueError:
        return jsonify({"error": "Invalid file_id format."}), 400

    file_path = os.path.join(UPLOAD_FOLDER, f"{data['file_id']}.csv")
    if not os.path.exists(file_path):
        return jsonify({"error": "Dataset not found or session expired. Please re-upload."}), 404

    try:
        df = pd.read_csv(file_path)
        col1, col2 = data["col1"], data["col2"]

        if col1 not in df.columns or col2 not in df.columns:
            return jsonify({"error": "Column not found in dataset."}), 400

        t1 = infer_col_type(df[col1])
        t2 = infer_col_type(df[col2])

        if t1 == "numeric" and t2 == "numeric":
            return jsonify(get_numeric_trendline(df, col1, col2))
        elif t1 == "date" and t2 == "numeric":
            return jsonify(get_time_series_agg(df, col1, col2))
        elif t2 == "date" and t1 == "numeric":
            return jsonify(get_time_series_agg(df, col2, col1))
        elif t1 == "numeric" and t2 in ("categorical", "string"):
            return jsonify(get_categorical_numeric_agg(df, col2, col1))
        elif t2 == "numeric" and t1 in ("categorical", "string"):
            return jsonify(get_categorical_numeric_agg(df, col1, col2))
        elif t1 in ("categorical", "string") and t2 in ("categorical", "string"):
            return jsonify(get_crosstab(df, col1, col2))
        else:
            return jsonify({"error": f"Cannot compare types: {t1} vs {t2}"}), 400
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"error": f"Internal Comparison Error: {str(e)}"}), 500


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8080, debug=True)
