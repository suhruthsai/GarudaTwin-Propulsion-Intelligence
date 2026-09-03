"""
Feature Engineering Module
Calculates 30s and 60s rolling window mean and standard deviation features
matching model_feature_cols.json schema.
"""

from typing import List, Dict, Any
import pandas as pd
import numpy as np

from ..config.config import SENSOR_COLS, ROLLING_WINDOWS, NOMINAL_DEFAULTS


class RollingFeatureExtractor:
    """
    Transforms raw or clean telemetry frames into engineered feature vectors
    with rolling statistics (rmean30, rstd30, rmean60, rstd60) required by
    trained scikit-learn/XGBoost models.
    """

    @staticmethod
    def compute_features(df: pd.DataFrame, expected_cols: List[str]) -> pd.DataFrame:
        """
        Computes 71 rolling window features from a pandas DataFrame of telemetry frames.
        
        Args:
            df: DataFrame containing telemetry sensor columns
            expected_cols: List of 71 feature names loaded from model_feature_cols.json
            
        Returns:
            DataFrame containing exactly expected_cols matching model input schema.
        """
        df_in = df.copy()

        # Handle CHT naming aliases
        if "true_cht" not in df_in.columns and "cht" in df_in.columns:
            df_in["true_cht"] = df_in["cht"]
        if "sensor_cht" not in df_in.columns and "cht" in df_in.columns:
            df_in["sensor_cht"] = df_in["cht"]
        if "cht" not in df_in.columns and "true_cht" in df_in.columns:
            df_in["cht"] = df_in["true_cht"]

        # Fill missing sensor columns with nominal defaults
        for col in SENSOR_COLS:
            if col not in df_in.columns:
                df_in[col] = NOMINAL_DEFAULTS.get(col, 0.0)

        # Build feature DataFrame starting with raw sensor columns
        features = df_in[SENSOR_COLS].copy()

        # Compute rolling window metrics
        for col in SENSOR_COLS:
            series = df_in[col]
            for w in ROLLING_WINDOWS:
                features[f"{col}_rmean{w}"] = series.rolling(w, min_periods=1).mean()
                features[f"{col}_rstd{w}"] = series.rolling(w, min_periods=1).std().fillna(0.0)

        # Forward fill and backward fill any lingering NaNs
        features = features.ffill().bfill().fillna(0.0)

        # Ensure exact column ordering as trained model expects
        for col in expected_cols:
            if col not in features.columns:
                features[col] = 0.0

        return features[expected_cols]
