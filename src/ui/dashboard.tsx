"use client";

import { useState, useEffect } from "react";

type SignalResult = {
  name: string;
  score: number;
  max: number;
  details: any;
};

type EEIEntity = {
  url: string;
  band: string;
  tier1: number;
  tier2: number;
  tier3: number;
  diagnostics: any;
  signals: SignalResult[];
};

export default function DashboardPage() {
  const [jobId, setJobId] = useState("");
  const [loading, setLoading] = useState(false);
  const [entity, setEntity] = useState<EEIEntity | null>(null);
  const [error, setError] = useState("");

  async function fetchResult() {
    if (!jobId) return;

    setLoading(true);
    setError("");
    setEntity(null);

    try {
      const res = await fetch(`/api/eei/public-result?jobId=${jobId}`);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const json = await res.json();
      if (!json.entity) {
        throw new Error("No entity data found");
      }
      setEntity(json.entity);
    } catch (err: any) {
      setError(err?.message || "Unknown error");
    }

    setLoading(false);
  }

  return (
    <div style={{ padding: "32px", maxWidth: 900, margin: "0 auto" }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 16 }}>
        EEI Audit Dashboard
      </h1>

      {/* Input box */}
      <div
        style={{
          display: "flex",
          gap: 12,
          marginBottom: 24,
          alignItems: "center",
        }}
      >
        <input
          type="text"
          placeholder="Enter Job ID…"
          value={jobId}
          onChange={(e) => setJobId(e.target.value)}
          style={{
            flex: 1,
            padding: "10px 14px",
            borderRadius: 6,
            border: "1px solid #ccc",
            fontSize: 14,
          }}
        />
        <button
          onClick={fetchResult}
          style={{
            padding: "10px 16px",
            background: "#111",
            color: "white",
            borderRadius: 6,
            border: "none",
            cursor: "pointer",
            fontWeight: 600,
          }}
        >
          Load
        </button>
      </div>

      {/* Loading */}
      {loading && <p style={{ opacity: 0.6 }}>Loading…</p>}

      {/* Error */}
      {error && (
        <p style={{ color: "red", fontWeight: 600, marginTop: 12 }}>{error}</p>
      )}

      {/* No data */}
      {!entity && !loading && !error && (
        <p style={{ opacity: 0.55 }}>Enter a Job ID to load results.</p>
      )}

      {/* Results */}
      {entity && (
        <div style={{ marginTop: 32 }}>
          {/* Band + URL */}
          <div style={{ marginBottom: 24 }}>
            <h2 style={{ fontSize: 22, marginBottom: 4 }}>{entity.url}</h2>
            <p style={{ fontSize: 18, fontWeight: 600 }}>
              Band: <span style={{ color: "#4b6ef5" }}>{entity.band}</span>
            </p>
          </div>

          {/* Tier scores */}
          <div
            style={{
              display: "flex",
              gap: 16,
              marginBottom: 32,
              flexWrap: "wrap",
            }}
          >
            {[
              { label: "Tier 1 — AI Comprehension", value: entity.tier1 },
              { label: "Tier 2 — Structural Data", value: entity.tier2 },
              { label: "Tier 3 — Page Hygiene", value: entity.tier3 },
            ].map((t, idx) => (
              <div
                key={idx}
                style={{
                  flex: "1 1 230px",
                  padding: 16,
                  borderRadius: 8,
                  border: "1px solid #ddd",
                }}
              >
                <div style={{ fontSize: 14, opacity: 0.7 }}>{t.label}</div>
                <div style={{ fontSize: 26, fontWeight: 700 }}>{t.value}</div>
              </div>
            ))}
          </div>

          {/* Signals */}
          <h3 style={{ fontSize: 20, marginBottom: 12 }}>Signals</h3>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 12,
              marginBottom: 32,
            }}
          >
            {entity.signals.map((s, i) => (
              <div
                key={i}
                style={{
                  padding: 16,
                  borderRadius: 8,
                  border: "1px solid #e0e0e0",
                }}
              >
                <div
                  style={{
                    fontSize: 16,
                    fontWeight: 600,
                    marginBottom: 4,
                  }}
                >
                  {s.name}
                </div>

                <div style={{ fontSize: 14, opacity: 0.7, marginBottom: 6 }}>
                  Score: {s.score} / {s.max}
                </div>

                <pre
                  style={{
                    background: "#fafafa",
                    padding: 12,
                    borderRadius: 6,
                    fontSize: 12,
                    overflow: "auto",
                    border: "1px solid #eee",
                  }}
                >
                  {JSON.stringify(s.details, null, 2)}
                </pre>
              </div>
            ))}
          </div>

          {/* Diagnostics */}
          <h3 style={{ fontSize: 20, marginBottom: 12 }}>Diagnostics</h3>
          <pre
            style={{
              background: "#fafafa",
              padding: 16,
              borderRadius: 8,
              fontSize: 12,
              overflow: "auto",
              border: "1px solid #eee",
            }}
          >
            {JSON.stringify(entity.diagnostics, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
