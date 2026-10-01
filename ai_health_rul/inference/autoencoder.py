"""
Single-frame deep autoencoder used by the legacy /detect-anomaly endpoint.
Trained on nominal simulator frames by training/train_models.py.
"""

import numpy as np
import torch
import torch.nn as nn

# Features: [RPM, Throttle, EGT1-4, CHT1-4, MAP, OilPress]
AE_FEATURE_NAMES = ["RPM", "Throttle", "EGT_Cyl1", "EGT_Cyl2", "EGT_Cyl3", "EGT_Cyl4",
                    "CHT_Cyl1", "CHT_Cyl2", "CHT_Cyl3", "CHT_Cyl4", "MAP", "Oil_Pressure"]
AE_MEANS = np.array([4800.0, 78.0, 840.0, 840.0, 840.0, 840.0, 106.0, 106.0, 106.0, 106.0, 1.42, 3.85], dtype=np.float32)
AE_STDS = np.array([600.0, 15.0, 45.0, 45.0, 45.0, 45.0, 15.0, 15.0, 15.0, 15.0, 0.35, 0.85], dtype=np.float32)


class EngineAnomalyAutoencoder(nn.Module):
    """12 -> 32 -> 16 -> 4 -> 16 -> 32 -> 12 reconstruction network."""

    def __init__(self, input_dim: int = 12, latent_dim: int = 4):
        super().__init__()
        self.encoder = nn.Sequential(
            nn.Linear(input_dim, 32),
            nn.BatchNorm1d(32),
            nn.LeakyReLU(0.1),
            nn.Linear(32, 16),
            nn.LeakyReLU(0.1),
            nn.Linear(16, latent_dim),
        )
        self.decoder = nn.Sequential(
            nn.Linear(latent_dim, 16),
            nn.LeakyReLU(0.1),
            nn.Linear(16, 32),
            nn.LeakyReLU(0.1),
            nn.Linear(32, input_dim),
        )

    def forward(self, x):
        z = self.encoder(x)
        return self.decoder(z), z


def normalise(raw: np.ndarray) -> np.ndarray:
    return (raw.astype(np.float32) - AE_MEANS) / AE_STDS
