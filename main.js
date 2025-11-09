document.getElementById("audit-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const url = document.getElementById("url-input").value.trim();
  const scoreLabel = document.getElementById("score-label");
  const scoreBar = document.getElementById("score-bar");
  const tierLabel = document.getElementById("tier-label");
  const signalsDiv = document.getElementById("signals");
  const jsonOutput = document.getElementById("json-output");

  scoreLabel.textContent = "Loading...";
  scoreBar.style.width = "0%";
  tierLabel.textContent = "";
  signalsDiv.innerHTML = "";
  jsonOutput.textContent = "";

  try {
    const res = await fetch(`/api/audit.js?url=${encodeURIComponent(url)}`);
    const data = await res.json();

    const { entityScore, entityTier, metrics } = data;

    // Update score bar
    scoreLabel.textContent = `EEI: ${entityScore} / 100`;
    scoreBar.style.width = `${entityScore}%`;
    tierLabel.textContent = entityTier;

    // Signal breakdown
    signalsDiv.innerHTML = "";
    for (const [key, value] of Object.entries(metrics)) {
      const points = value.points || 0;
      const strength = Math.min(100, (points / value.max) * 100 || 0);

      const div = document.createElement("div");
      div.className = "signal-item";
      div.innerHTML = `
        <span>${key}</span>
        <span>${points} / ${value.max}</span>
        <div class="signal-bar" style="width:${strength}%;"></div>
      `;
      signalsDiv.appendChild(div);
    }

    // Raw JSON
    jsonOutput.textContent = JSON.stringify(data, null, 2);
  } catch (err) {
    jsonOutput.textContent = `Error: ${err.message}`;
  }
});
