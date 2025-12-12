document.addEventListener("DOMContentLoaded", () => {
  const urlInput = document.getElementById("urlInput");
  const startBtn = document.getElementById("startBtn");

  const loading = document.getElementById("loading");
  const errorBox = document.getElementById("error");
  const resultSection = document.getElementById("result");

  const jobIdField = document.getElementById("jobId");
  const tierField = document.getElementById("tier");
  const bandField = document.getElementById("band");
  const signalsTable = document.querySelector("#signalsTable tbody");
  const diagnosticsBox = document.getElementById("diagnosticsBox");

  // ==========================================
  // Step 1: POST URL → /api/eei/start
  // ==========================================
  startBtn.addEventListener("click", async () => {
    const url = urlInput.value.trim();

    if (!url) {
      alert("Please enter a URL to audit.");
      return;
    }

    errorBox.classList.add("hidden");
    resultSection.classList.add("hidden");
    loading.textContent = "Starting audit…";
    loading.classList.remove("hidden");

    let jobId = null;

    try {
      const startRes = await fetch("/api/eei/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url })
      });

      if (!startRes.ok) throw new Error(`start.ts error: ${startRes.status}`);

      const startData = await startRes.json();
      jobId = startData.jobId;

      if (!jobId) throw new Error("start.ts did not return a jobId.");

    } catch (err) {
      loading.classList.add("hidden");
      errorBox.textContent = `Error starting audit: ${err.message}`;
      errorBox.classList.remove("hidden");
      return;
    }

    // ==========================================
    // Step 2: GET /api/eei/public-result?jobId=...
    // ==========================================
    loading.textContent = "Loading audit result…";

    try {
      const res = await fetch(`/api/eei/public-result?jobId=${encodeURIComponent(jobId)}`);

      if (!res.ok) throw new Error(`public-result error: ${res.status}`);

      const data = await res.json();

      loading.classList.add("hidden");
      resultSection.classList.remove("hidden");

      // Fill summary
      jobIdField.textContent = jobId;
      tierField.textContent = data.tier || "N/A";
      bandField.textContent = data.band || "N/A";

      // Fill signals
      signalsTable.innerHTML = "";
      (data.signals || []).forEach(sig => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${sig.key}</td>
          <td>${sig.points} / ${sig.max}</td>
          <td>${sig.notes}</td>
        `;
        signalsTable.appendChild(tr);
      });

      // Diagnostics JSON
      diagnosticsBox.textContent = JSON.stringify(data.diagnostics, null, 2);

    } catch (err) {
      loading.classList.add("hidden");
      errorBox.textContent = `Error fetching result: ${err.message}`;
      errorBox.classList.remove("hidden");
    }
  });
});

